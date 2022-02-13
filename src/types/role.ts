/**
 * 役職定義
 */
export const enum ROLE {
  /** 人狼 */
  WereWolf = 'WereWolf',
  /** 占い師 */
  FortuneTeller = 'FortuneTeller',
  /** 霊媒師 */
  Medium = 'Medium',
  /** 狩人（騎士） */
  Hunter = 'Hunter',
  /** 狂人 */
  Maniac = 'Maniac',
  /** 村人 */
  Villager = 'Villager',
}

/**
 * 文字列から列挙型に変換する
 * @param value 文字列
 * @returns 列挙型
 */
export const getRoleByString = (value: string): ROLE => {
  switch (value) {
    case ROLE.WereWolf:
      return ROLE.WereWolf;
    case ROLE.FortuneTeller:
      return ROLE.FortuneTeller;
    case ROLE.Medium:
      return ROLE.Medium;
    case ROLE.Hunter:
      return ROLE.Hunter;
    case ROLE.Maniac:
      return ROLE.Maniac;
    case ROLE.Villager:
      return ROLE.Villager;
    default:
      throw new Error(`unexpected value: ${value}`);
  }
};
