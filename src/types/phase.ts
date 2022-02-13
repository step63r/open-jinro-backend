/**
 * フェーズ定義
 */
export const enum PHASE {
  /** 開始 */
  Start = 'Start',
  /** 議論 */
  Discussion = 'Discussion',
  /** 投票 */
  Voting = 'Voting',
  /** 投票結果 */
  VotingResult = 'VotingResult',
  /** 夜 */
  Night = 'Night',
}

/**
 * 文字列から列挙型に変換する
 * @param value 文字列
 * @returns 列挙型
 */
export const getPhaseByString = (value: string): PHASE => {
  switch (value) {
    case PHASE.Start:
      return PHASE.Start;
    case PHASE.Discussion:
      return PHASE.Discussion;
    case PHASE.Voting:
      return PHASE.Voting;
    case PHASE.VotingResult:
      return PHASE.VotingResult;
    case PHASE.Night:
      return PHASE.Night;
    default:
      throw new Error(`unexpected value: ${value}`);
  }
};
