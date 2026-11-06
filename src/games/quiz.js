import { MAX_QUESTIONS } from '../../data/quiz.js';
import { callbackButton, messageWithKeyboard } from '../keyboard.js';

const INTRO = [
  'Викторина! Отвечайте кнопками — кто первый верно нажал, тот и забрал очко.',
  'Вопросов: {count}. Поехали.',
].join('\n');

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function displayName(user) {
  if (!user) return 'Игрок';
  return [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || 'Игрок';
}

export class QuizGame {
  constructor({ api, chatId, questionsPerGame = 10, answerTimeoutSec = 25, pauseMs = 2500, onFinished }) {
    this.api = api;
    this.chatId = chatId;
    this.onFinished = onFinished;
    this.timeoutMs = answerTimeoutSec * 1000;
    this.pauseMs = pauseMs;

    const pool = shuffle(MAX_QUESTIONS).slice(0, questionsPerGame);
    this.questions = pool.map((question) => {
      const options = shuffle(question.options.map((text, index) => ({ text, correct: index === question.correct })));
      return {
        text: question.text,
        options,
        correctIndex: options.findIndex((option) => option.correct),
      };
    });

    this.index = -1;
    this.scores = new Map();
    this.resolved = true;
    this.timeout = null;
    this.blocked = new Set();
  }

  get isRunning() {
    return !this.finished;
  }

  async start() {
    await this.api.sendMessage(this.chatId, {
      text: INTRO.replace('{count}', String(this.questions.length)),
    });
    await this.askNext();
  }

  async askNext() {
    this.index += 1;
    clearTimeout(this.timeout);

    if (this.index >= this.questions.length) {
      return this.finish();
    }

    const question = this.questions[this.index];
    this.resolved = false;
    this.blocked = new Set();

    const rows = question.options.map((option, optionIndex) => [
      callbackButton(option.text, `quiz:${this.index}:${optionIndex}`),
    ]);

    await this.api.sendMessage(
      this.chatId,
      messageWithKeyboard(
        `Вопрос ${this.index + 1}/${this.questions.length}\n\n${question.text}`,
        rows
      )
    );

    this.timeout = setTimeout(() => this.revealNobody(), this.timeoutMs);
    this.timeout.unref?.();
  }

  async revealNobody() {
    if (this.resolved) return;
    this.resolved = true;
    const question = this.questions[this.index];
    const correct = question.options[question.correctIndex].text;
    await this.safeSend(`Время вышло. Правильный ответ: ${correct}`);
    this.scheduleNext();
  }

  async handleAnswer({ index, optionIndex, user }) {
    if (this.finished || this.resolved) return { ignored: true };
    if (index !== this.index) return { ignored: true };

    const question = this.questions[this.index];
    const isCorrect = optionIndex === question.correctIndex;
    const name = displayName(user);

    if (!isCorrect) {
      if (!this.blocked.has(user?.user_id)) {
        this.blocked.add(user?.user_id);
        await this.safeSend(`${name}: мимо.`);
      }
      return { correct: false };
    }

    this.resolved = true;
    clearTimeout(this.timeout);
    const entry = this.scores.get(user?.user_id) ?? { name, score: 0 };
    entry.score += 1;
    entry.name = name;
    this.scores.set(user?.user_id, entry);

    await this.safeSend(`Верно, ${name}! +1 очко.`);
    this.scheduleNext();
    return { correct: true };
  }

  scheduleNext() {
    this.timeout = setTimeout(() => {
      this.askNext().catch((error) => console.error('askNext:', error));
    }, this.pauseMs);
    this.timeout.unref?.();
  }

  async finish() {
    this.finished = true;
    clearTimeout(this.timeout);

    if (this.scores.size === 0) {
      await this.safeSend('Игра окончена: никто не набрал очков.');
    } else {
      const table = [...this.scores.values()]
        .sort((a, b) => b.score - a.score)
        .map((entry, i) => `${i + 1}. ${entry.name} — ${entry.score}`)
        .join('\n');
      await this.safeSend(`Игра окончена. Счёт:\n${table}`);
    }

    await this.onFinished?.(this);
  }

  stop() {
    clearTimeout(this.timeout);
    this.finished = true;
  }

  async safeSend(text) {
    try {
      await this.api.sendMessage(this.chatId, { text });
    } catch (error) {
      console.error('sendMessage:', error.message);
    }
  }
}

export const quizMeta = {
  name: 'Викторина',
  description: 'Вопросы с кнопками, очко за первый верный ответ',
  startCommands: ['/quiz', '/викторина'],
  stopCommands: ['/stop', '/стоп'],
};
