/**
 * Pythonの zip 関数と同等の実装
 * @param rows 
 * @returns 
 */
export const zip = (rows: Array<Array<any>>): any[][] => {
  return rows[0].map((_, c) => rows.map(row => row[c]));
}
