/** 酒馆风格占位符：{{user}} {{char}}，以及老写法 <USER> <BOT>。大小写不敏感。 */
export function expandMacros(text: string, names: { user: string; char: string }): string {
  if (!text) return text;
  return text
    .replace(/\{\{\s*user\s*\}\}|<USER>/gi, names.user)
    .replace(/\{\{\s*char\s*\}\}|<BOT>|<CHAR>/gi, names.char);
}
