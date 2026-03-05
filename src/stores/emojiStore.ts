import { defineStore } from 'pinia';
import { ref } from 'vue';

const EMOJIS = [
  // Faces
  '😀', '😁', '😂', '🤣', '😃', '😄', '😅', '😆', '😉', '😊',
  '😋', '😎', '😍', '🤩', '🥳', '😏', '😒', '😞', '😔', '😟',
  '😕', '🙁', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😤',
  '😠', '😡', '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰',
  '😥', '😓', '🤗', '🤔', '🤫', '🤥', '😶', '😐', '😑', '😬',
  '🙄', '😯', '😦', '😧', '😮', '😲', '🥱', '😴', '🤤', '😪',
  '😵', '🤐', '🥴', '🤢', '🤮', '🤧', '😷', '🤒', '🤕', '🤑',
  '🤠', '😈', '👿', '👻', '💀', '👽', '👾', '🤖', '🎃',
  '😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '😾',
  // Animals
  '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯',
  '🦁', '🐮', '🐷', '🐸', '🐵', '🙈', '🙉', '🙊', '🐔', '🐧',
  '🐦', '🐤', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄',
  '🐝', '🐛', '🦋', '🐌', '🐞', '🐜', '🦟', '🦗', '🐢', '🐍',
  '🦎', '🦖', '🦕', '🐙', '🦑', '🦐', '🦞', '🦀', '🐡', '🐠',
  '🐟', '🐬', '🐳', '🐋', '🦈', '🐊', '🐅', '🐆', '🦓', '🦍',
  '🦧', '🐘', '🦛', '🦏', '🐪', '🐫', '🦒', '🦘', '🐃', '🐂',
  '🐄', '🐎', '🐖', '🐏', '🐑', '🦙', '🐐', '🦌', '🐕', '🐩',
  '🦮', '🐈', '🐓', '🦃', '🦚', '🦜', '🦢', '🕊️',
  // Plants & nature
  '🌵', '🌲', '🌳', '🌴', '🌱', '🌿', '🍀', '🍁', '🍂', '🍃',
  '🌺', '🌸', '🌼', '🌻', '🌹', '🥀', '🌷', '💐', '🍄', '🌾',
  // Food
  '🍎', '🍊', '🍋', '🍇', '🍓', '🍒', '🍑', '🍍', '🥝', '🍅',
  '🥑', '🥦', '🥕', '🌽', '🍕', '🍔', '🍟', '🌭', '🍿', '🥚',
  '🍳', '🧇', '🥞', '🧈', '🍞', '🥐', '🧀', '🌮', '🌯', '🍱',
  '🍣', '🍜', '🍝', '🍛', '🍲', '🍦', '🍧', '🍨', '🍩', '🍪',
  '🎂', '🍰', '🧁', '🍫', '🍬', '🍭', '🍮', '🍯', '☕', '🍵',
  // Objects
  '💻', '🖥️', '⌨️', '🖱️', '💾', '💿', '📷', '📸', '📱', '📞',
  '📺', '📻', '🎙️', '🧭', '⏱️', '⌛', '⏰', '📡', '🔋', '🔌',
  '💡', '🔦', '🕯️', '🧲', '🔭', '🔬', '💊', '💉', '🩺', '🔧',
  '🔨', '⚙️', '🔩', '🪛', '🔑', '🗝️', '🔐', '🔒', '🔓', '🚪',
  '✏️', '🖊️', '🖋️', '📝', '📖', '📚', '🗃️', '📁', '📂', '📌',
  // Sports & games
  '⚽', '🏀', '🏈', '⚾', '🎾', '🏐', '🏉', '🎱', '🏓', '🏸',
  '⛳', '🎣', '🥊', '🥋', '🛹', '🛼', '🛷', '🎽', '🎳', '🎮',
  '🕹️', '🎲', '♟️', '🎯', '🧩', '🪀', '🪁', '🎪', '🎨', '🎭',
  // Travel & places
  '✈️', '🚀', '🛸', '🚁', '⛵', '🚢', '🚗', '🚕', '🚙', '🏎️',
  '🚓', '🚑', '🚒', '🏖️', '🏝️', '🗻', '🏔️', '🌋', '🗼', '🏰',
  // Symbols & misc
  '⭐', '🌟', '✨', '💫', '🌈', '☀️', '🌙', '⛅', '🌊', '🔥',
  '💥', '❄️', '🌀', '⚡', '💧', '🎵', '🎶', '🎸', '🎹', '🎺',
  '🎻', '🥁', '🪘', '🎤', '🎧', '🏆', '🥇', '🎖️', '🏅', '🎗️',
  '🔮', '🧿', '💎', '💰', '🌐', '🗺️', '🧭', '🧸', '🎀', '🎁',
];

export const useEmojiStore = defineStore('emoji', () => {
  const sessionEmojis = ref(new Map<string, string>());

  function getSessionEmoji(sessionId: string): string | undefined {
    return sessionEmojis.value.get(sessionId);
  }

  function assignSessionEmoji(
    sessionId: string,
    parentSessionId?: string,
    forcedEmoji?: string,
  ): void {
    if (sessionEmojis.value.has(sessionId)) return;

    if (forcedEmoji) {
      sessionEmojis.value.set(sessionId, forcedEmoji);
      return;
    }

    if (parentSessionId) {
      const parentEmoji = sessionEmojis.value.get(parentSessionId);
      if (parentEmoji) {
        sessionEmojis.value.set(sessionId, parentEmoji);
        return;
      }
    }

    const emoji = EMOJIS[Math.floor(Math.random() * EMOJIS.length)]!;
    sessionEmojis.value.set(sessionId, emoji);
  }

  function removeSessionEmoji(sessionId: string): void {
    sessionEmojis.value.delete(sessionId);
  }

  return { getSessionEmoji, assignSessionEmoji, removeSessionEmoji };
});
