import crypto from 'crypto';
import socketio, { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';

import { PHASE } from './types/phase';
import { ROLE } from './types/role';
import { Room } from './types/room';
import { User } from './types/user';

import { RedisRoomStore } from './stores/roomStore';
import { RedisUserStore } from './stores/userStore';

const HUMAN_WIN = 'HumanWin';
const WOLVES_WIN = 'WolvesWin';
const CONTINUE_GAME = 'ContinueGame';

const io = new Server({
  cors: {
    origin: 'http://localhost:3001',
    methods: ['GET', 'POST'],
  },
});

const pubClient = new Redis({ host: 'localhost', port: 6379 });
const subClient = pubClient.duplicate();
io.adapter(createAdapter(pubClient, subClient));

// あとでRedisにブチ込む
const roomStore = new RedisRoomStore(pubClient);
const userStore = new RedisUserStore(pubClient);

pubClient.on('error', (err) => {
  console.log(`[pub] ${err}`);
});

subClient.on('error', (err) => {
  console.log(`[sub] ${err}`);
});

/**
 * ランダムな半角英数列を取得する
 * @param length 文字列長
 * @returns ランダムな半角英数列
 */
const getId = (length: number = 8): string => {
  const S = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return Array.from(crypto.randomFillSync(new Uint8Array(length))).map((n) => S[n % S.length]).join('');
};

/**
 * ルームに所属するユーザー一覧を取得する
 * @param roomId ルームID
 * @returns ユーザー一覧
 */
const getUsersInRoom = async (roomId: string): Promise<User[]> => {
  const room = await roomStore.getRoom(roomId);
  if (room) {
    const users = (await userStore.getUsers()).filter((user) => room.userIds.includes(user.id));
    return users;
  } else {
    console.log(`getUserInRoom: Room not found (ID: ${roomId}).`);
  }
  return [];
};

/**
 * 待受状態をチェックする
 * @param room ルーム
 * @returns true: 待受完了, false: 待受中
 */
const checkAwaitStatus = async (room: Room): Promise<boolean> => {
  const users = await getUsersInRoom(room.id);
  const aliveUsers = users.filter((v) => v.isAlive);
  const awaitingUsers = aliveUsers.filter((v) => v.isAwaiting);
  return aliveUsers.length === awaitingUsers.length;
};

/**
 * 待受状態をリセットする
 * @param room ルーム
 */
const resetIsAwaiting = async (room: Room): Promise<void> => {
  const users = await getUsersInRoom(room.id);
  users.map((v) => {
    v.isAwaiting = false;
    userStore.setUser(v);
  });
};

/**
 * 被投票数をリセットする
 * @param room ルーム
 */
const resetVoteCount = async (room: Room): Promise<void> => {
  const users = await getUsersInRoom(room.id);
  users.map((v) => {
    v.voteCount = 0;
    userStore.setUser(v);
  });
};

/**
 * 最多得票者を取得する
 * @param room 
 * @returns 最多得票者
 */
const getSuspects = async (room: Room): Promise<string[]> => {
  const users = await getUsersInRoom(room.id);
  const max = Math.max(...users.map((v) => v.voteCount));
  const suspects = users.filter((v) => v.voteCount === max);
  return [...suspects.map((v) => v.id)];
};

/**
 * ゲーム終了判定
 * @param roomId ルームID
 * @returns 
 */
const judge = async (roomId: string) => {
  const room = await roomStore.getRoom(roomId);
  if (room) {
    const users = await getUsersInRoom(roomId);
    const aliveWolves = users.filter((v) => v.isAlive && v.role === ROLE.WereWolf);
    const aliveHumans = users.filter((v) => v.isAlive && v.role !== ROLE.WereWolf);

    if (aliveWolves.length === 0) {
      return HUMAN_WIN;

    } else if (aliveWolves.length >= aliveHumans.length) {
      return WOLVES_WIN;

    } else {
      // ゲーム続行
    }
  } else {
    console.log(`judge: Room not found (ID: ${roomId}).`);
  }
  return CONTINUE_GAME;
};

io.on('connection', (socket: socketio.Socket) => {
  socket.on('disconnect', async () => {
    // ...
  });

  socket.on('create', (room: Room, user: User) => {
    const roomId = getId();
    const userId = getId(16);

    room.id = roomId;
    user.id = userId;
    user.isHost = true;
    room.userIds.push(user.id);
    userStore.setUser(user);
    roomStore.setRoom(room);

    socket.join(roomId);
    socket.emit('create', room, user);
  });

  socket.on('join', async (roomId: string, user: User) => {
    const userId = getId(16);

    user.id = userId;
    user.isHost = false;
    const room = await roomStore.getRoom(roomId);
    if (room && !room.inProgress) {
      room.userIds.push(user.id);
      roomStore.setRoom(room);
      userStore.setUser(user);
      socket.join(roomId);
      socket.emit('join', room, user);
      const users = await getUsersInRoom(roomId);
      io.to(roomId).emit('onMemberChanged', room, users);
    } else {
      console.log(`[${socket.id}] join: Room not found or already started.`);
    }
  });

  socket.on('getRoom', async (roomId: string) => {
    const room = await roomStore.getRoom(roomId);
    if (room) {
      socket.emit('getRoom', room, await getUsersInRoom(roomId));
    } else {
      console.log(`[${socket.id}] getRoom: Room not found (ID: ${roomId}).`);
    }
  });

  socket.on('getUser', async (userId: string) => {
    const user = (await userStore.getUsers()).find((v) => v.id === userId);
    if (user) {
      socket.emit('getUser', user);
    } else {
      console.log(`[${socket.id}] getUser: User not found (ID: ${userId}).`);
    }
  });

  socket.on('leave', async (roomId: string, user: User) => {
    const room = await roomStore.getRoom(roomId);
    if (room) {
      const userIds = room.userIds.filter((v) => v !== user.id);
      room.userIds = [...userIds];
      roomStore.setRoom(room);
      socket.leave(roomId);
      socket.emit('leave', room, user);
      const userNames = (await getUsersInRoom(roomId)).map((v) => v.name);
      io.to(roomId).emit('onMemberChanged', room, userNames);
    } else {
      console.log(`[${socket.id}] leave: Room not found (ID: ${roomId}).`);
    }
  });

  socket.on('choice', async (roomId: string) => {
    const room = await roomStore.getRoom(roomId);
    const choices: ROLE[] = [];
    if (room) {
      for (let i = 0; i < room.rule.wereWolves; i++) {
        choices.push(ROLE.WereWolf);
      }
      for (let i = 0; i < room.rule.fortuneTellers; i++) {
        choices.push(ROLE.FortuneTeller);
      }
      for (let i = 0; i < room.rule.mediumns; i++) {
        choices.push(ROLE.Medium);
      }
      for (let i = 0; i < room.rule.hunters; i++) {
        choices.push(ROLE.Hunter);
      }
      for (let i = 0; i < room.rule.maniacs; i++) {
        choices.push(ROLE.Maniac);
      }
      for (let i = 0; i < room.rule.villagers; i++) {
        choices.push(ROLE.Villager);
      }

      // Random sort of Fisher-Yates
      for (let i = choices.length - 1; i > 0; i--) {
        const r = Math.floor(Math.random() * (i + 1));
        const tmp = choices[i];
        choices[i] = choices[r];
        choices[r] = tmp;
      }

      for (let i = 0; i < room.userIds.length; i++) {
        const user = await userStore.getUser(room.userIds[i]);
        if (user) {
          user.role = choices[i];
          userStore.setUser(user);
        } else {
          console.log(`[${socket.id}] choice: User not found (ID: ${room.userIds[i]}).`);
        }
      }

      room.days += 1;
      roomStore.setRoom(room);
      io.to(roomId).emit('choice', room);

    } else {
      console.log(`[${socket.id}] choice: Room not found (ID: ${roomId}).`);
    }
  });

  socket.on('vote', async (roomId: string, userId: string) => {
    const room = await roomStore.getRoom(roomId);
    if (room) {
      const user = await userStore.getUser(userId);
      if (user) {
        user.voteCount += 1;
        userStore.setUser(user);
        socket.emit('vote', room, await getUsersInRoom(roomId));
      } else {
        console.log(`[${socket.id}] vote: User not found (ID: ${userId}).`);
      }
    } else {
      console.log(`[${socket.id}] vote: Room not found (ID: ${roomId}).`);
    }
  });

  socket.on('murder', async (roomId: string, userId: string) => {
    const room = await roomStore.getRoom(roomId);
    if (room) {
      const user = await userStore.getUser(userId);
      if (user) {
        user.voteCount += 1;
        userStore.setUser(user);
        socket.emit('murder', room, await getUsersInRoom(roomId));
      } else {
        console.log(`[${socket.id}] murder: User not found (ID: ${userId}).`);
      }
    } else {
      console.log(`[${socket.id}] murder: Room not found (ID: ${roomId}).`);
    }
  });

  socket.on('hunt', async (roomId: string, userId: string) => {
    const room = await roomStore.getRoom(roomId);
    if (room) {
      const user = await userStore.getUser(userId);
      if (user) {
        room.lastHunted = user.id;
        roomStore.setRoom(room);
        socket.emit('hunt', room, await getUsersInRoom(roomId));
      } else {
        console.log(`[${socket.id}] murder: User not found (ID: ${userId}).`);
      }
    } else {
      console.log(`[${socket.id}] hunt: Room not found (ID: ${roomId}).`);
    }
  });

  socket.on('awaitStart', async (roomId: string, userId: string) => {
    const room = await roomStore.getRoom(roomId);
    if (room) {
      const user = await userStore.getUser(userId);
      if (user) {
        user.isAwaiting = true;
        userStore.setUser(user);
        if (await checkAwaitStatus(room)) {
          resetIsAwaiting(room);
          room.inProgress = true;
          room.days += 1;
          room.phase = PHASE.Discussion;
          roomStore.setRoom(room);

          io.to(roomId).emit('awaitStart', room);
        }
      } else {
        console.log(`[${socket.id}] awaitStart: User not found (ID: ${userId}).`);
      }
    } else {
      console.log(`[${socket.id}] awaitStart: Room not found (ID: ${roomId}).`);
    }
  });

  socket.on('awaitDiscussion', async (roomId: string, userId: string) => {
    const room = await roomStore.getRoom(roomId);
    if (room) {
      const user = await userStore.getUser(userId);
      if (user) {
        user.isAwaiting = true;
        userStore.setUser(user);
        if (await checkAwaitStatus(room)) {
          resetIsAwaiting(room);
          room.lastLynched = null;
          room.lastMurdered = null;
          room.phase = PHASE.Voting;
          roomStore.setRoom(room);

          io.to(roomId).emit('awaitDiscussion', room, await getUsersInRoom(roomId));
        }
      } else {
        console.log(`[${socket.id}] awaitDiscussion: User not found (ID: ${userId}).`);
      }
    } else {
      console.log(`[${socket.id}] awaitDiscussion: Room not found (ID: ${roomId}).`);
    }
  });

  socket.on('awaitVoting', async (roomId: string, userId: string) => {
    const room = await roomStore.getRoom(roomId);
    if (room) {
      const user = await userStore.getUser(userId);
      if (user) {
        user.isAwaiting = true;
        userStore.setUser(user);
        if (await checkAwaitStatus(room)) {
          await resetIsAwaiting(room);

          const suspects = await getSuspects(room);
          // 追放チェック
          if (suspects.length === 1) {
            // 追放確定
            const user = await userStore.getUser(suspects[0]);
            
            if (user) {
              user.isAlive = false;
              userStore.setUser(user);

              room.lastLynched = suspects[0];
              room.isFinalVoting = false;
              roomStore.setRoom(room);
              resetVoteCount(room);

            } else {
              console.log(`[${socket.id}] awaitVoting: User not found (ID: ${suspects[0]}).`);
            }

          } else {
            if (!room.isFinalVoting) {
              // 引き分け -> 決戦投票へ
              room.isFinalVoting = true;
              roomStore.setRoom(room);
              resetVoteCount(room);

            } else {
              // 引き分け -> 追放なし
              room.isFinalVoting = false;
              roomStore.setRoom(room);
              resetVoteCount(room);
            }
          }

          room.phase = PHASE.VotingResult;
          roomStore.setRoom(room);

          const suspectUsers = (await getUsersInRoom(roomId)).filter((v) => suspects.includes(v.id));
          io.to(roomId).emit('awaitVoting', room, await getUsersInRoom(roomId), suspectUsers);
        }
      } else {
        console.log(`[${socket.id}] awaitVoting: User not found (ID: ${userId}).`);
      }
    } else {
      console.log(`[${socket.id}] awaitVoting: Room not found (ID: ${roomId}).`);
    }
  });

  socket.on('awaitVotingResult', async (roomId: string, userId: string) => {
    const room = await roomStore.getRoom(roomId);
    if (room) {
      const user = await userStore.getUser(userId);
      if (user) {
        user.isAwaiting = true;
        userStore.setUser(user);
        if (await checkAwaitStatus(room)) {
          await resetIsAwaiting(room);

          if (room.isFinalVoting) {
            room.phase = PHASE.Discussion;
            roomStore.setRoom(room);

          } else {
            const status = await judge(roomId);
            if (status === HUMAN_WIN || status === WOLVES_WIN) {
              io.to(roomId).emit('gameSet', room, await getUsersInRoom(roomId), status);
              return;

            } else {
              room.phase = PHASE.Night;
              roomStore.setRoom(room);
            }
          }

          io.to(roomId).emit('awaitVotingResult', room, await getUsersInRoom(roomId));
        }
      } else {
        console.log(`[${socket.id}] awaitVotingResult: User not found.`);
      }
    } else {
      console.log(`[${socket.id}] awaitVotingResult: Room not found.`);
    }
  });

  socket.on('awaitNight', async (roomId: string, userId: string) => {
    const room = await roomStore.getRoom(roomId);
    if (room) {
      const user = await userStore.getUser(userId);
      if (user) {
        user.isAwaiting = true;
        userStore.setUser(user);
        if (await checkAwaitStatus(room)) {
          await resetIsAwaiting(room);

          const suspects = await getSuspects(room);
          if (suspects.length === 1) {
            const user = await userStore.getUser(suspects[0]);

            if (user) {
              if (user.id === room.lastHunted) {
                // 狩人（騎士）により守られたため襲撃失敗

              } else {
                // 襲撃成功
                user.isAlive = false;
                userStore.setUser(user);
                room.lastMurdered = suspects[0];
                roomStore.setRoom(room);
              }
            } else {
              console.log(`[${socket.id}] awaitNight: User not found (ID: ${suspects[0]}).`);
            }
            
          } else {
            // 最多得票者が複数いるため襲撃失敗
          }

          const status = await judge(roomId);
          if (status === HUMAN_WIN || status === WOLVES_WIN) {
            io.to(roomId).emit('gameSet', room, await getUsersInRoom(roomId), status);
          } else {
            resetVoteCount(room);
            room.lastHunted = null;
            room.days += 1;
            room.phase = PHASE.Discussion;
            roomStore.setRoom(room);
  
            io.to(roomId).emit('awaitNight', room, await getUsersInRoom(roomId));
          }
        }
      } else {
        console.log(`[${socket.id}] awaitNight: User not found.`);
      }
    } else {
      console.log(`[${socket.id}] awaitNight: Room not found.`);
    }
  });
});

io.listen(3000);
console.log(`server is listening on port 3000.`);
