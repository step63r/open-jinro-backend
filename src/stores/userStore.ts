import Redis from "ioredis";
import { ROLE, getRoleByString } from "../types/role";
import { User } from "../types/user";
import {
  mapBooleanToString,
  mapStringToBoolean,
} from '../utils/typeConverter';

/**
 * ユーザー情報管理インターフェイス
 */
interface IUserStore {
  getUser(id: string): Promise<User | undefined>;
  getUsers(): Promise<User[]>;
  setUser(user: User): Promise<void>;
}

/**
 * ユーザー情報管理クラス（インメモリ）
 */
class InMemoryUserStore implements IUserStore {
  private _users = new Map<string, User>();

  /**
   * ユーザーIDからユーザー情報を取得する
   * @param id ユーザーID
   * @returns ユーザー情報
   */
  async getUser(id: string): Promise<User | undefined> {
    return this._users.get(id);
  }

  /**
   * ユーザー一覧を取得する
   * @returns 
   */
  async getUsers(): Promise<User[]> {
    return [...this._users.values()];
  }

  /**
   * ユーザー情報を設定する
   * @param user ユーザー情報
   */
  async setUser(user: User): Promise<void> {
    this._users.set(user.id, user);
  }
}

/** 生存期間 */
const TTL = 24 * 60 * 60;

/**
 * Redisの応答をUser型に変換する
 * @param param0 
 * @returns 
 */
const mapUser = ([id, name, isHost, role, isAlive, voteCount, isAwaiting]: Array<string | null>): User | undefined => {
  if (id) {
    const user: User = {
      id: id,
      name: name ?? '',
      isHost: mapStringToBoolean(isHost),
      role: role ? getRoleByString(role) : ROLE.WereWolf,
      isAlive: mapStringToBoolean(isAlive),
      voteCount: voteCount ? parseInt(voteCount) : 0,
      isAwaiting: mapStringToBoolean(isAwaiting),
    };
    return user;

  } else {
    return undefined;
  }
}

/**
 * ユーザー情報管理クラス（Redis）
 */
class RedisUserStore implements IUserStore {
  private readonly _client: Redis.Redis;

  /**
   * コンストラクタ
   * @param redisClient Redisクライアント
   */
  constructor(redisClient: Redis.Redis) {
    this._client = redisClient;
  }

  /**
   * ユーザーIDからユーザー情報を取得する
   * @param id ユーザーID
   * @returns ユーザー情報
   */
  async getUser(id: string): Promise<User | undefined> {
    return await this._client
      .hmget(`user:${id}`, 'id', 'name', 'isHost', 'role', 'isAlive', 'voteCount', 'isAwaiting')
      .then(mapUser);
  }

  /**
   * ユーザー一覧を取得する
   * @returns 
   */
  async getUsers(): Promise<User[]> {
    const keys = new Set<string>();
    let nextIndex = 0;
    do {
      const [nextIndexAsStr, results] = await this._client.scan(
        nextIndex,
        'MATCH',
        'user:*',
        'COUNT',
        100
      );
      nextIndex = parseInt(nextIndexAsStr, 10);
      results.forEach((s) => keys.add(s));
    } while (nextIndex !== 0);

    const commands: Array<Array<string>> = [];
    keys.forEach((key) => {
      commands.push([
        'hmget',
        key,
        'id',
        'name',
        'isHost',
        'role',
        'isAlive',
        'voteCount',
        'isAwaiting']);
    });

    return await this._client
      .multi(commands)
      .exec()
      .then((results) => {
        return results
          .map(([err, session]) => (err ? undefined : mapUser(session)))
          .filter((v): v is User => v !== undefined);   // ユーザー定義Type Guard
      });
  }

  /**
   * ユーザー情報を設定する
   * @param user ユーザー情報
   */
  async setUser(user: User): Promise<void> {
    this._client
      .multi()
      .hset(
        `user:${user.id}`,
        'id', user.id,
        'name', user.name,
        'isHost', mapBooleanToString(user.isHost),
        'role', user.role,
        'isAlive', mapBooleanToString(user.isAlive),
        'voteCount', user.voteCount,
        'isAwaiting', mapBooleanToString(user.isAwaiting)
      )
      .expire(`user:${user.id}`, TTL)
      .exec();
  }
}

export {
  InMemoryUserStore,
  RedisUserStore,
};
