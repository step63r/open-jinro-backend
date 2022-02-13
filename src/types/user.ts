import { ROLE } from "./role";

/**
 * ユーザー定義
 */
export type User = {
  /** ユーザーID */
  id: string,
  /** ユーザー名 */
  name: string,
  /** ホストフラグ */
  isHost: boolean,
  /** 役職 */
  role: ROLE,
  /** 生存フラグ */
  isAlive: boolean,
  /** 被投票数 */
  voteCount: number,
  /** 待受中フラグ */
  isAwaiting: boolean,
};
