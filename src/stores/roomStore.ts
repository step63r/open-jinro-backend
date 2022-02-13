import Redis from "ioredis";
import { Room } from "../types/room";
import { Rule } from '../types/rule';
import { PHASE, getPhaseByString } from '../types/phase';
import { zip } from '../utils/iterTools';
import {
  mapBooleanToString,
  mapStringToBoolean,
} from '../utils/typeConverter';

/**
 * ルーム情報管理インターフェイス
 */
interface IRoomStore {
  getRoom(id: string): Promise<Room | undefined>;
  getRooms(): Promise<Room[]>;
  setRoom(room: Room): Promise<void>;
}

/**
 * ルーム情報管理クラス（インメモリ）
 */
class InMemoryRoomStore implements IRoomStore {
  private _rooms = new Map<string, Room>();

  /**
   * ルームIDからルーム情報を取得する
   * @param id ルームID
   * @returns ルーム情報
   */
  async getRoom(id: string): Promise<Room | undefined> {
    return this._rooms.get(id);
  }

  /**
   * ルーム一覧を取得する
   * @returns ルーム一覧
   */
  async getRooms(): Promise<Room[]> {
    return [...this._rooms.values()];
  }

  /**
   * ルーム情報を設定する
   * @param room ルーム情報
   */
  async setRoom(room: Room): Promise<void> {
    this._rooms.set(room.id, room);
  }
}

/** 生存期間 */
const TTL = 24 * 60 * 60;

/**
 * Redisの応答をRoom型に変換する
 * @param param0 
 * @returns 
 */
const mapRoom = ([id, name, inProgress, days, phase, isFinalVoting, lastLynched, lastMurdered, lastHunted]: Array<string | null>): Room | undefined => {
  if (id) {
    const room: Room = {
      id: id,
      name: name ?? '',
      rule: {               // 後で設定
        wereWolves: 1,
        fortuneTellers: 1,
        mediumns: 0,
        hunters: 0,
        maniacs: 0,
        villagers: 4,
      },
      userIds: [],          // 後で設定
      inProgress: mapStringToBoolean(inProgress),
      days: days ? parseInt(days) : 0,
      phase: phase ? getPhaseByString(phase) : PHASE.Discussion,
      isFinalVoting: mapStringToBoolean(isFinalVoting),
      lastLynched: lastLynched,
      lastMurdered: lastMurdered,
      lastHunted: lastHunted,
    };
    return room;

  } else {
    return  undefined;
  }
}

/**
 * Redisの応答をRule型に変換する
 * @param param0 
 * @returns 
 */
const mapRule = ([wereWolves, fortuneTellers, mediumns, hunters, maniacs, villagers]: Array<string | null>): Rule => {
  const rule: Rule = {
    wereWolves: wereWolves ? parseInt(wereWolves) : 0,
    fortuneTellers: fortuneTellers ? parseInt(fortuneTellers) : 0,
    mediumns: mediumns ? parseInt(mediumns) : 0,
    hunters: hunters ? parseInt(hunters) : 0,
    maniacs: maniacs ? parseInt(maniacs) : 0,
    villagers: villagers ? parseInt(villagers) : 0,
  }
  return rule;
}

/**
 * ルーム情報管理クラス（Redis）
 */
class RedisRoomStore implements IRoomStore {
  private readonly _client: Redis.Redis;

  /**
   * コンストラクタ
   * @param redisClient Redisクライアント
   */
  constructor(redisClient: Redis.Redis) {
    this._client = redisClient;
  }

  /**
   * インスタンスが指定した型であるかチェックする
   * @param arg 
   * @returns 
   */
  private isType<T>(arg: any): arg is T {
    return arg !== undefined;
  }

  /**
   * ルームIDからルーム情報を取得する
   * @param id ルームID
   * @returns ルーム情報
   */
  async getRoom(id: string): Promise<Room | undefined> {
    const room = await this._client
      .hmget(`room:${id}`, 'id', 'name', 'inProgress', 'days', 'phase', 'isFinalVoting', 'lastLynched', 'lastMurdered', 'lastHunted')
      .then(mapRoom);
    
    if (room) {
      const userIds = await this._client.lrange(`userIds:${id}`, 0, -1);
      room.userIds = [...userIds];

      const rule = await this._client
        .hmget(`rule:${id}`, 'wereWolves', 'fortuneTellers', 'mediumns', 'hunters', 'maniacs', 'villagers')
        .then(mapRule);
      room.rule = { ...rule };
    }
    
    return room;
  }

  /**
   * ルーム一覧を取得する
   * @returns ルーム一覧
   */
  async getRooms(): Promise<Room[]> {
    const roomKeys = new Set<string>();
    const userIdsKeys = new Set<string>();
    const ruleKeys = new Set<string>();

    /** スキャン：ルーム */
    let nextIndex = 0;
    do {
      const [nextIndexAsStr, results] = await this._client.scan(
        nextIndex,
        'MATCH',
        'room:*',
        'COUNT',
        100
      );
      nextIndex = parseInt(nextIndexAsStr, 10);
      results.forEach((s) => roomKeys.add(s));
    } while (nextIndex !== 0);

    /** スキャン：ユーザー一覧 */
    nextIndex = 0;
    do {
      const [nextIndexAsStr, results] = await this._client.scan(
        nextIndex,
        'MATCH',
        'userIds:*',
        'COUNT',
        100
      );
      nextIndex = parseInt(nextIndexAsStr, 10);
      results.forEach((s) => userIdsKeys.add(s));
    } while (nextIndex !== 0);

    /** スキャン：ルール */
    nextIndex = 0;
    do {
      const [nextIndexAsStr, results] = await this._client.scan(
        nextIndex,
        'MATCH',
        'rule:*',
        'COUNT',
        100
      );
      nextIndex = parseInt(nextIndexAsStr, 10);
      results.forEach((s) => ruleKeys.add(s));
    } while (nextIndex !== 0);

    const roomCommands: Array<Array<string>> = [];
    const userIdsCommands: Array<Array<string>> = [];
    const ruleCommands: Array<Array<string>> = [];

    /** コマンド生成：ルーム */
    roomKeys.forEach((key) => {
      roomCommands.push([
        'hmget',
        key,
        'id',
        'name',
        'inProgress',
        'days',
        'phase',
        'isFinalVoting',
        'lastLynched',
        'lastMurdered',
        'lastHunted']);
    });

    /** コマンド生成：ユーザー一覧 */
    userIdsKeys.forEach((key) => {
      userIdsCommands.push(['lrange', key, '0', '-1']);
    });

    /** コマンド生成：ルール */
    ruleKeys.forEach((key) => {
      ruleCommands.push([
        'hmget',
        key,
        'wereWolves',
        'fortuneTellers',
        'mediumns',
        'hunters',
        'maniacs',
        'villagers']);
    });

    /** データ取得：ルーム */
    const roomList = await this._client
      .multi(roomCommands)
      .exec()
      .then((results) => {
        return results
          .map(([err, session]) => (err ? undefined : mapRoom(session)))
          .filter((v): v is Room => v !== undefined);   // ユーザー定義Type Guard
      });
    
    /** データ取得：ユーザー一覧 */
    const userIdsList = await this._client
      .multi(userIdsCommands)
      .exec()
      .then((results) => {
        return results
          .map(([err, session]) => (err ? undefined : session))
          .filter((v): v is string[] => typeof v !== undefined);
      });
    
    const ruleList = await this._client
      .multi(ruleCommands)
      .exec()
      .then((results) => {
        return results
          .map(([err, session]) => (err ? undefined : mapRule(session)))
          .filter((v): v is Rule => v !== undefined);
      });
    
    // ↓zipでマッピングに不一致が生じたらIDで割り振るしかない
    // const userIdsKeysArray = Array.from(userIdsKeys);
    // const ruleKeysArray = Array.from(ruleKeys);

    for (const [room, userIds, rule] of zip([roomList, userIdsList, ruleList])) {
      if (this.isType<Room>(room) && this.isType<string[]>(userIds) && this.isType<Rule>(rule)) {
        room.rule = { ...rule };
        room.userIds = [...userIds];

      } else {
        console.log('[error] invalid type of room or userIds or rule.');
        console.log(`  room: ${JSON.stringify(room)}`);
        console.log(`  userIds: ${JSON.stringify(userIds)}`);
        console.log(`  rule: ${JSON.stringify(rule)}`);
      }
    }
    return roomList;
  }

  /**
   * ルーム情報を設定する
   * @param room ルーム情報
   */
  async setRoom(room: Room): Promise<void> {
    this._client
      .multi()
      .del(`userIds:${room.id}`)
      .hset(
        `rule:${room.id}`,
        'wereWolves', room.rule.wereWolves,
        'fortuneTellers', room.rule.fortuneTellers,
        'mediumns', room.rule.mediumns,
        'hunters', room.rule.hunters,
        'maniacs', room.rule.maniacs,
        'villagers', room.rule.villagers,
      )
      .lpush(`userIds:${room.id}`, ...room.userIds)
      .hset(
        `room:${room.id}`,
        'id', room.id,
        'name', room.name,
        'inProgress', mapBooleanToString(room.inProgress),
        'days', room.days,
        'phase', getPhaseByString(room.phase),
        'isFinalVoting', mapBooleanToString(room.isFinalVoting),
        'lastLynched', room.lastLynched ?? '',
        'lastMurdered', room.lastMurdered ?? '',
        'lastHunted', room.lastHunted ?? ''
      )
      .expire(`userIds:${room.id}`, TTL)
      .expire(`rule:${room.id}`, TTL)
      .expire(`room:${room.id}`, TTL)
      .exec();
  }
}

export {
  InMemoryRoomStore,
  RedisRoomStore,
};
