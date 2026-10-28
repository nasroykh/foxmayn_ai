/** Escape LIKE wildcards so a value is matched literally. */
export const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");
