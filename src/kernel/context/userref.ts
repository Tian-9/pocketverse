import { expandMacros } from './macros';

/**
 * 「对方」在库里统一存成 {{user}}，发给模型和显示时再换成这一局的名字（见 userNameOf）。
 * 模型写的记忆、状态、事实常带着名字或「用户」两个字；存库前换成占位符，改名后旧内容自动跟着变，
 * 也不会把「用户」这种说法喂回给聊天模型。
 */
export const USER_MACRO = '{{user}}';

/** 名字能不能安全地整词替换：太短（「我」）或就是「用户」的不换，免得把正文里的字换没了 */
function replaceable(name: string | undefined): name is string {
  const n = name?.trim();
  return !!n && n.length >= 2 && n !== '用户';
}

/** 存库前：这一局的名字和「用户」→ {{user}} */
export function toUserMacro(text: string, userName?: string): string {
  if (!text) return text;
  let t = text;
  if (replaceable(userName)) t = t.split(userName.trim()).join(USER_MACRO);
  return t.replace(/用户/g, USER_MACRO);
}

/** 显示或发出前：{{user}} / {{char}} → 名字 */
export function fromUserMacro(text: string, userName: string, charName: string): string {
  return expandMacros(text, { user: userName, char: charName });
}
