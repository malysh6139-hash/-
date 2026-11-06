export function inlineKeyboard(rows) {
  return {
    type: 'inline_keyboard',
    payload: { buttons: rows },
  };
}

export function callbackButton(text, payload) {
  return { type: 'callback', text, payload };
}

export function linkButton(text, url) {
  return { type: 'link', text, url };
}

export function messageWithKeyboard(text, rows) {
  return { text, attachments: [inlineKeyboard(rows)] };
}
