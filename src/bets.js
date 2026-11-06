import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { callbackButton, inlineKeyboard } from './keyboard.js';

function dative(name) {
  const parts = String(name).trim().split(/\s+/);
  const last = parts.pop() ?? '';
  const lower = last.toLowerCase();
  let form = last;

  if (/[йь]$/.test(lower)) form = `${last.slice(0, -1)}ю`;
  else if (/[ая]$/.test(lower)) form = `${last.slice(0, -1)}е`;
  else if (!/[оеёыиуюэ]$/.test(lower)) form = `${last}у`;

  return [...parts, form].join(' ');
}

function pluralBeers(count, forms = ['кружка', 'кружки', 'кружек']) {
  const n = Math.abs(count) % 100;
  const n1 = n % 10;
  if (n > 10 && n < 20) return `${count} ${forms[2]}`;
  if (n1 === 1) return `${count} ${forms[0]}`;
  if (n1 >= 2 && n1 <= 4) return `${count} ${forms[1]}`;
  return `${count} ${forms[2]}`;
}

function displayName(user) {
  if (!user) return 'Игрок';
  return [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || 'Игрок';
}

function normalizeValue(value) {
  return String(value).toLowerCase().replace(/\s+/g, '').replace(/ё/g, 'е');
}

function sideKey(value) {
  return normalizeValue(value).replace(/[^0-9a-zа-я]/g, '');
}

function memberOf(value, members) {
  const key = sideKey(value);
  if (key.length < 3) return null;

  let best = null;
  let bestScore = 0;
  for (const member of members) {
    const full = sideKey([member.first_name, member.last_name].filter(Boolean).join(' '));
    const short = sideKey(member.first_name ?? '');
    for (const candidate of [full, short]) {
      if (candidate.length < 3) continue;
      let common = 0;
      while (common < key.length && common < candidate.length && key[common] === candidate[common]) common += 1;
      if (common >= 3 && common > bestScore) {
        best = member;
        bestScore = common;
      }
    }
  }
  return best;
}

function personName(member) {
  return [member.first_name, member.last_name].filter(Boolean).join(' ') || String(member.user_id);
}

function betTarget(value) {
  return String(value)
    .replace(/^\/?((ставлю|ставка|ставлю\s+на|ставлю|за|на)\s+)+/i, '')
    .trim();
}

function looksLikeVerdict(value) {
  return /(выигра|победи|проигра|слил|затащил|сильнее|лучше)/i.test(String(value));
}

function parseVerdict(value) {
  const clean = String(value).replace(/^\/?(итог|результат)\s*/i, '').trim();
  const lost = /(проигра|проиграл|слил|слилась|обосрал|лажает)/i.test(clean);
  const won = /(выигра|выиграл|побед|затащил|лучше|сильнее|первый)/i.test(clean);
  const name = clean
    .replace(/(выиграл[аи]?|выигрывает|победил[аи]?|побеждает|проиграл[аи]?|проигрывает|слил[аи]?|сливает|лучше|сильнее|затащил[аи]?|первый|вторая|второй)/gi, '')
    .trim();
  return { name, lost, won };
}

function stripCommand(text) {
  return text.replace(/^\/?\S+\s*/, '').trim();
}

function parseScore(value) {
  const text = String(value).trim();
  const paired = text.match(/(\d{1,2})\s*[:/xх\-–—]\s*(\d{1,2})/i);
  if (paired) return `${Number(paired[1])}:${Number(paired[2])}`;

  const bare = text.match(/^(\d)(\d)$/);
  if (bare) return `${Number(bare[1])}:${Number(bare[2])}`;

  return null;
}

export class BetsService {
  constructor(api, statePath) {
    this.api = api;
    this.statePath = statePath;
    this.state = this.load();
  }

  load() {
    if (!existsSync(this.statePath)) {
      return { nextId: 1, events: [], debts: {}, names: {} };
    }
    try {
      const parsed = JSON.parse(readFileSync(this.statePath, 'utf8'));
      return {
        nextId: parsed.nextId ?? 1,
        events: parsed.events ?? [],
        debts: parsed.debts ?? {},
        names: parsed.names ?? {},
      };
    } catch {
      return { nextId: 1, events: [], debts: {}, names: {} };
    }
  }

  save() {
    mkdirSync(dirname(this.statePath), { recursive: true });
    writeFileSync(this.statePath, JSON.stringify(this.state, null, 2), 'utf8');
  }

  remember(user) {
    if (!user?.user_id) return;
    this.state.names[user.user_id] = displayName(user);
  }

  nameOf(id) {
    return this.state.names[id] ?? `id${id}`;
  }

  openEventOf(chatId) {
    return this.state.events
      .filter((event) => event.chatId === chatId && event.status === 'open')
      .sort((a, b) => b.id - a.id)[0];
  }

  async membersOf(chatId) {
    try {
      const response = await this.api.call('GET', `/chats/${chatId}/members`, { query: { count: 100 } });
      return (response?.members ?? []).filter((member) => !member.is_bot);
    } catch (error) {
      console.error('members:', error.message);
      return [];
    }
  }

  static buildOptions(body) {
    let core = body;
    let score = null;

    const tail = body.match(/^(.*?)\s*(\d{1,2})\s*[:/xх\-–—]\s*(\d{1,2})$/i) ?? body.match(/^(.*?)\s+(\d)(\d)$/);
    if (tail && tail[1].trim()) {
      core = tail[1].trim();
      score = `${Number(tail[2])}:${Number(tail[3])}`;
    }

    if (core.includes('|')) {
      const parts = core.split('|').map((part) => part.trim()).filter(Boolean);
      const [subject, ...options] = parts;
      return { subject, options: options.length >= 2 ? options.slice(0, 6) : null, sides: null, score, mode: 'options' };
    }

    const versus = core.match(/^(.+?)\s*(?:[-–—]|против|vs\.?|versus)\s*(.+)$/i);
    if (versus) {
      return {
        subject: core,
        options: [],
        sides: [versus[1].trim(), versus[2].trim()],
        score,
        mode: 'score',
      };
    }

    const words = core.split(/\s+/).filter(Boolean);
    if (words.length === 2) {
      return {
        subject: core,
        options: [],
        sides: [words[0], words[1]],
        score,
        mode: 'score',
      };
    }

    if (score && words.length > 2) {
      return {
        subject: `${words[0]} ${words[1]}`,
        options: [],
        sides: [words[0], words[1]],
        score,
        mode: 'score',
      };
    }

    if (words.length > 2) {
      const first = words.slice(0, -1).join(' ');
      const second = words.at(-1);
      return { subject: `${first} ${second}`, options: [first, second], sides: [first, second], score: null, mode: 'options' };
    }

    return { subject: body, options: null, sides: null, score: null, mode: null };
  }

  async openEvent(chatId, text, user) {
    if (!user?.user_id) {
      console.error('openEvent: в событии нет отправителя');
      return;
    }
    this.remember(user);

    const first = String(text).trim().split(/\s+/)[0].toLowerCase().replace(/^\//, '');
    const body = ['спор', 'ставка', 'bet'].includes(first) ? stripCommand(text) : String(text).trim();
    if (!body) {
      await this.api.sendMessage(chatId, {
        text: [
          'Спорим на кружку. Скажи, на что: спор Зенит-Локо',
          'Хочешь свои варианты — через черту: спор Кто забьёт | Зенит | Локо | Никто',
          'Ставка больше одной: спор 2 Зенит-Локо',
        ].join('\n'),
      });
      return;
    }

    const withStake = body.match(/^(\d{1,3})\s+(.+)$/);
    const stake = withStake ? Math.max(1, Number(withStake[1])) : 1;
    const rest = withStake ? withStake[2].trim() : body;

    const built = BetsService.buildOptions(rest);

    if (built.sides && !built.options?.length && !built.score) {
      const members = await this.membersOf(chatId);
      const left = memberOf(built.sides[0], members);
      const right = memberOf(built.sides[1], members);
      const versus = /против|vs\.?|versus/i.test(rest);
      if ((left && right) || (versus && (left || right))) {
        built.mode = 'options';
        built.options = [
          left ? personName(left) : built.sides[0],
          right ? personName(right) : built.sides[1],
        ];
      }
    }

    if (!built.options) {
      await this.api.sendMessage(chatId, {
        text: [
          `«${built.subject}» — а кто с кем играет?`,
          'Напиши как матч: спор Зенит-Локо',
          'Или дай свои варианты: спор Кто забьёт | Зенит | Локо | Никто',
        ].join('\n'),
      });
      return;
    }

    const previous = this.openEventOf(chatId);
    if (previous) previous.status = 'cancelled';

    const event = {
      id: this.state.nextId,
      chatId,
      subject: built.subject,
      stake,
      mode: built.mode ?? 'options',
      options: built.mode === 'score' ? (built.sides ?? []) : built.options,
      sides: built.sides,
      picks: [],
      author: { id: user.user_id, name: this.nameOf(user.user_id) },
      status: 'open',
      result: null,
      createdAt: Date.now(),
    };
    this.state.nextId += 1;
    this.state.events.push(event);

    if (built.score) {
      if (event.mode === 'score') {
        event.picks.push({ userId: user.user_id, name: this.nameOf(user.user_id), pick: built.score, createdAt: Date.now() });
      } else {
        const [left, right] = built.score.split(':').map(Number);
        const autoIndex = this.optionByScore(event, left, right);
        if (autoIndex >= 0) {
          event.picks.push({ userId: user.user_id, name: this.nameOf(user.user_id), optionIndex: autoIndex, createdAt: Date.now() });
        }
      }
    }

    this.save();

    const sent = await this.api.sendMessage(chatId, this.renderCard(event));
    event.messageId = sent?.message?.body?.mid ?? null;
    this.save();
  }

  pickLabel(event, pick) {
    if (pick.pick) return pick.pick;
    return event.options?.[pick.optionIndex] ?? '—';
  }

  resolvedIndex(event, pick) {
    if (pick.optionIndex !== undefined && pick.optionIndex !== null) return pick.optionIndex;
    if (!pick.pick) return -1;
    const [left, right] = pick.pick.split(':').map(Number);
    return this.optionByScore(event, left, right);
  }

  renderCard(event) {
    const count = event.picks.length;
    const who = count === 0 ? 'пока никто не поставил' : `уже поставили: ${count}`;
    const header = `🍺 Спор #${event.id}: ${event.subject}`;
    const stakeLine = `На кону ${pluralBeers(event.stake)} с того, кто промахнулся. Замутил ${event.author?.name ?? 'кто-то'}.`;
    const lines = event.picks.map((pick) => `${this.nameOf(pick.userId)} — ${this.pickLabel(event, pick)}`);

    const hints =
      event.mode === 'score'
        ? [
            'Ставка: жми победителя или пиши счёт — 2:1 (можно 21)',
            'Как сыграли — ответь на это сообщение счётом или напиши: итог 2:1',
          ]
        : ['Ставка: жми свой вариант или напиши имя', 'Как всё решится — напиши: итог <вариант>'];

    const payload = {
      text: [header, stakeLine, who, '', ...(lines.length ? lines : ['—']), '', ...hints].join('\n'),
    };
    if (event.options?.length) payload.attachments = [inlineKeyboard(this.buttons(event))];
    return payload;
  }

  buttons(event) {
    return event.options.map((option, index) => {
      const picked = event.picks.filter((pick) => this.resolvedIndex(event, pick) === index).length;
      return [callbackButton(picked ? `${option} · ${picked}` : option, `pick:${event.id}:${index}`)];
    });
  }

  async updateCard(event, text) {
    const payload = text
      ? event.mode === 'score'
        ? { text }
        : { text, attachments: [inlineKeyboard(this.buttons(event))] }
      : this.renderCard(event);

    if (!event.messageId) {
      await this.api.sendMessage(event.chatId, payload);
      return;
    }

    try {
      await this.api.editMessage(event.messageId, payload);
    } catch (error) {
      console.error('editMessage:', error.message);
      await this.api.sendMessage(event.chatId, payload);
    }
  }

  findEvent(eventId) {
    return this.state.events.find((event) => event.id === eventId);
  }

  matchOption(event, value) {
    const normalized = normalizeValue(value);
    if (!normalized) return -1;

    const exact = event.options.findIndex((option) => normalizeValue(option) === normalized);
    if (exact >= 0) return exact;

    const prefixed = event.options.findIndex((option) => normalized.startsWith(normalizeValue(option)));
    if (prefixed >= 0) return prefixed;

    const key = sideKey(value);
    if (key.length < 3) return -1;

    let best = -1;
    let bestScore = 0;
    event.options.forEach((option, index) => {
      const candidate = sideKey(option);
      let common = 0;
      while (common < key.length && common < candidate.length && key[common] === candidate[common]) common += 1;
      if (common >= 3 && common > bestScore) {
        best = index;
        bestScore = common;
      }
    });
    return best;
  }

  async tryPickByText(chatId, text, user) {
    const event = this.openEventOf(chatId);
    if (!event) return false;
    if (!user?.user_id) return false;

    const clean = String(text).trim();
    if (!clean || clean.length > 60) return false;

    this.remember(user);
    const name = this.nameOf(user.user_id);

    const score = event.mode === 'score' ? parseScore(clean) : null;
    const index = score ? -1 : this.matchOption(event, betTarget(clean));

    if (!score && index < 0) return false;

    const existing = event.picks.find((pick) => pick.userId === user.user_id);
    if (existing) {
      const same = score ? existing.pick === score : !existing.pick && this.resolvedIndex(event, existing) === index;
      if (same) return true;

      event.warned = event.warned ?? [];
      if (event.warned.includes(user.user_id)) return true;
      event.warned.push(user.user_id);
      this.save();
      await this.api.sendMessage(chatId, {
        text: `${name}, ты уже поставил на ${this.pickLabel(event, existing)}. Всё, назад дороги нет.`,
      });
      return true;
    }

    if (score) event.picks.push({ userId: user.user_id, name, pick: score, createdAt: Date.now() });
    else event.picks.push({ userId: user.user_id, name, optionIndex: index, createdAt: Date.now() });

    this.save();
    await this.updateCard(event);
    await this.applyPending(event);
    return true;
  }

  standings(event) {
    const lines = event.options.map((option, index) => {
      const names = event.picks
        .filter((pick) => this.resolvedIndex(event, pick) === index)
        .map((pick) => this.nameOf(pick.userId));
      return `${option}: ${names.length ? names.join(', ') : '—'}`;
    });
    return [`Спор #${event.id}: ${event.subject}`, ...lines, '', 'Итог: итог <вариант>'].join('\n');
  }

  async pick(chatId, eventId, optionIndex, user) {
    const event = this.findEvent(eventId);
    if (!event || event.status !== 'open') {
      await this.api.sendMessage(chatId, { text: 'Этот спор уже посчитали. Замути новый: спор Зенит-Локо' });
      return;
    }
    if (!event.options[optionIndex]) return;

    this.remember(user);
    const name = this.nameOf(user.user_id);

    const existing = event.picks.find((pick) => pick.userId === user.user_id);
    if (existing) {
      if (existing.optionIndex === optionIndex) return;

      event.warned = event.warned ?? [];
      if (event.warned.includes(user.user_id)) return;
      event.warned.push(user.user_id);
      this.save();

      await this.api.sendMessage(chatId, {
        text: `${name}, ты уже поставил на «${event.options[existing.optionIndex]}». Всё, назад дороги нет.`,
      });
      return;
    }

    event.picks.push({ userId: user.user_id, name, optionIndex, createdAt: Date.now() });
    this.save();

    await this.updateCard(event);
    await this.applyPending(event);
  }

  optionByScore(event, left, right) {
    if (!event.sides) return -1;
    const [first, second] = event.sides;
    const key = left > right ? first : left < right ? second : 'Ничья';
    return event.options.findIndex((option) => normalizeValue(option) === normalizeValue(key));
  }

  async handleReply(chatId, replyMid, text, user) {
    if (!replyMid) return false;

    const target = this.state.events.find((item) => item.chatId === chatId && item.messageId === replyMid);
    const event = target ?? this.openEventOf(chatId);
    if (!event) return false;

    if (event.status !== 'open') {
      if (target) {
        await this.api.sendMessage(chatId, { text: 'Этот спор уже посчитали. Замути новый.' });
        return true;
      }
      return false;
    }

    const clean = String(text).trim();
    const mine = event.picks.find((pick) => pick.userId === user?.user_id);
    const score = parseScore(clean);

    if (/^\/?(итог|результат)(\s|$)/i.test(clean) || looksLikeVerdict(clean)) {
      await this.setResult(chatId, clean, event);
      return true;
    }

    if (mine) {
      const index = score ? -1 : this.matchOption(event, betTarget(clean));
      if (!score && index < 0) return false;
      await this.setResult(chatId, clean, event);
      return true;
    }

    return this.tryPickByText(chatId, clean, user);
  }

  async applyPending(event) {
    if (!event?.pendingResult || event.status !== 'open') return;
    if (event.picks.length < 2) return;

    const actual = event.pendingResult;
    event.pendingResult = null;
    if (typeof actual === 'number') await this.setOptionResult(event.chatId, actual, event);
    else await this.setScoreResult(event.chatId, actual, event);
  }

  async setScoreResult(chatId, actual, event) {
    if (event.picks.length < 2) {
      event.pendingResult = actual;
      this.save();
      await this.api.sendMessage(chatId, {
        text: `Счёт ${actual} записал. Посчитаю, как только поставит второй.`,
      });
      return;
    }

    event.pendingResult = null;

    const [left, right] = actual.split(':').map(Number);
    const sideIndex = this.optionByScore(event, left, right);
    const isWinner = (pick) =>
      pick.pick ? pick.pick === actual : sideIndex >= 0 && pick.optionIndex === sideIndex;

    const winners = event.picks.filter(isWinner);
    const losers = event.picks.filter((pick) => !isWinner(pick));

    event.status = 'done';
    event.result = actual;

    for (const winner of winners) {
      for (const loser of losers) {
        this.payDebt(loser.userId, winner.userId, event.stake);
      }
    }
    this.save();

    const lines = event.picks.map(
      (pick) => `${isWinner(pick) ? '✅' : '❌'} ${this.nameOf(pick.userId)} — ${this.pickLabel(event, pick)}`
    );

    let verdict;
    if (!winners.length) verdict = `Никто не угадал ${actual}. Долгов нет.`;
    else if (!losers.length) verdict = 'Угадали все. Долгов нет.';
    else {
      const pairs = winners
        .flatMap((winner) => losers.map((loser) => `${this.nameOf(loser.userId)} проставляется ${dative(this.nameOf(winner.userId))} — ${pluralBeers(event.stake, ['кружку', 'кружки', 'кружек'])}`))
        .join(', ');
      verdict = `${pairs}`;
    }

    const cardText = [
      `🍺 Спор #${event.id}: ${event.subject}`,
      `На кону ${pluralBeers(event.stake)}.`,
      `Счёт: ${actual}.`,
      '',
      ...lines,
      '',
      verdict,
    ].join('\n');

    await this.updateCard(event, cardText);
    await this.api.sendMessage(chatId, {
      text: `Спор #${event.id} закрыт: ${event.subject} — ${actual}.\n${verdict}`,
    });
  }

  async setResult(chatId, text, explicitEvent) {
    const event = explicitEvent ?? this.openEventOf(chatId);
    if (!event) {
      await this.api.sendMessage(chatId, { text: 'Споров нет. Скажи, на что спорим: спор Зенит-Локо' });
      return;
    }

    const value = text.replace(/^\/?(итог|результат)(\s+|$)/i, '').trim();
    if (!value) {
      await this.api.sendMessage(chatId, { text: 'Напиши, чем кончилось: итог Локо или счёт 2:1' });
      return;
    }

    if (event.mode === 'score') {
      const actual = parseScore(value);
      if (!actual) {
        await this.api.sendMessage(chatId, { text: 'Напиши счёт, например 2:1' });
        return;
      }
      await this.setScoreResult(chatId, actual, event);
      return;
    }

    const verdictInfo = parseVerdict(value);
    const target = verdictInfo.name || value;

    const asNumber = Number(value);
    const byNumber = Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= event.options.length;

    let index = this.matchOption(event, target);
    if (index < 0) index = this.matchOption(event, betTarget(target));
    if (index < 0 && byNumber) index = asNumber - 1;
    if (index < 0) {
      const actual = parseScore(value);
      if (actual) {
        const [left, right] = actual.split(':').map(Number);
        index = this.optionByScore(event, left, right);
      }
    }

    if (index >= 0 && verdictInfo.lost && event.options.length === 2) {
      index = index === 0 ? 1 : 0;
    }

    if (index < 0) {
      await this.api.sendMessage(chatId, {
        text: `Такого варианта не было. Ставили на: ${event.options.join(' / ')}`,
      });
      return;
    }

    await this.setOptionResult(chatId, index, event);
  }

  async setOptionResult(chatId, index, event) {
    if (event.picks.length < 2) {
      event.pendingResult = index;
      this.save();
      await this.api.sendMessage(chatId, {
        text: `Итог «${event.options[index]}» записал. Посчитаю, как только поставит второй.`,
      });
      return;
    }

    event.pendingResult = null;

    const winners = event.picks.filter((pick) => this.resolvedIndex(event, pick) === index);
    const losers = event.picks.filter((pick) => this.resolvedIndex(event, pick) !== index);

    event.status = 'done';
    event.result = event.options[index];

    for (const winner of winners) {
      for (const loser of losers) {
        this.payDebt(loser.userId, winner.userId, event.stake);
      }
    }
    this.save();

    const lines = event.options.map((option, optionIndex) => {
      const names = event.picks
        .filter((pick) => this.resolvedIndex(event, pick) === optionIndex)
        .map((pick) => this.nameOf(pick.userId));
      if (!names.length) return null;
      return `${optionIndex === index ? '✅' : '❌'} ${option} — ${names.join(', ')}`;
    }).filter(Boolean);

    let verdict;
    if (!winners.length) verdict = 'Никто не угадал. Долгов нет.';
    else if (!losers.length) verdict = 'Угадали все. Долгов нет.';
    else {
      const pairs = winners
        .flatMap((winner) => losers.map((loser) => `${this.nameOf(loser.userId)} проставляется ${dative(this.nameOf(winner.userId))} — ${pluralBeers(event.stake, ['кружку', 'кружки', 'кружек'])}`))
        .join(', ');
      verdict = `${pairs}`;
    }

    const cardText = [
      `🍺 Спор #${event.id}: ${event.subject}`,
      `На кону ${pluralBeers(event.stake)}.`,
      `Как закончилось: ${event.options[index]}.`,
      '',
      ...lines,
      '',
      verdict,
    ].join('\n');

    await this.updateCard(event, cardText);

    await this.api.sendMessage(chatId, {
      text: `Спор #${event.id} закрыт: ${event.subject} — ${event.options[index]}.\n${verdict}`,
    });
  }

  payDebt(debtor, creditor, amount) {
    const key = `${debtor}>${creditor}`;
    const reverse = `${creditor}>${debtor}`;
    let rest = amount;

    const reverseDebt = this.state.debts[reverse] ?? 0;
    if (reverseDebt > 0) {
      const offset = Math.min(reverseDebt, rest);
      const left = reverseDebt - offset;
      if (left === 0) delete this.state.debts[reverse];
      else this.state.debts[reverse] = left;
      rest -= offset;
    }

    if (rest > 0) {
      this.state.debts[key] = (this.state.debts[key] ?? 0) + rest;
    }
  }

  async listPicks(chatId) {
    const event = this.openEventOf(chatId);
    if (!event) {
      await this.api.sendMessage(chatId, { text: 'Активного спора нет.' });
      return;
    }

    let members = [];
    try {
      const response = await this.api.call('GET', `/chats/${chatId}/members`, { query: { count: 100 } });
      members = response?.members ?? [];
    } catch (error) {
      console.error('members:', error.message);
    }

    const humans = members.filter((member) => !member.is_bot);
    const lines = humans.map((member) => {
      const name = [member.first_name, member.last_name].filter(Boolean).join(' ') || member.username || member.user_id;
      const pick = event.picks.find((item) => item.userId === member.user_id);
      return `${pick ? '•' : '·'} ${name} — ${pick ? this.pickLabel(event, pick) : 'пока не поставил'}`;
    });

    const known = new Set(humans.map((member) => member.user_id));
    for (const pick of event.picks) {
      if (!known.has(pick.userId)) lines.push(`• ${this.nameOf(pick.userId)} — ${this.pickLabel(event, pick)}`);
    }

    if (event.listMid) {
      try {
        await this.api.deleteMessage(event.listMid);
      } catch (error) {
        console.error('delete table:', error.message);
      }
      event.listMid = null;
    }

    const sent = await this.api.sendMessage(chatId, {
      text: [
        `Спор #${event.id}: ${event.subject}, на кону ${pluralBeers(event.stake)}.`,
        `Поставили: ${event.picks.length} из ${humans.length}.`,
        '',
        ...lines,
      ].join('\n'),
    });

    event.listMid = sent?.message?.body?.mid ?? null;
    this.save();
  }

  async listDebts(chatId) {
    const entries = Object.entries(this.state.debts).filter(([, amount]) => amount > 0);
    if (entries.length === 0) {
      await this.api.sendMessage(chatId, { text: 'Долгов нет, все чистые.' });
      return;
    }

    const lines = entries
      .sort((a, b) => b[1] - a[1])
      .map(([key, amount]) => {
        const [debtor, creditor] = key.split('>').map(Number);
        return `${this.nameOf(debtor)} проставляется ${dative(this.nameOf(creditor))} — ${pluralBeers(amount, ['кружку', 'кружки', 'кружек'])}`;
      });

    await this.api.sendMessage(chatId, { text: `Кто кому проставляется:\n${lines.join('\n')}` });
  }
}

export const betsCommands = {
  open: ['/bet', '/спор', '/ставка'],
  result: ['/итог', '/результат'],
  debts: ['/beers', '/долги', '/счёт'],
};
