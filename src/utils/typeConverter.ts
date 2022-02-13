/**
 * boolean -> string
 * @param value 
 * @returns 
 */
export const mapBooleanToString = (value: boolean): string => {
  return value ? 'true' : 'false';
};

/**
 * string -> boolean
 * @param value 
 * @returns 
 */
export const mapStringToBoolean = (value: string | null | undefined): boolean => {
  if (value) {
    return value === 'true';
  } else {
    return false;
  }
}
