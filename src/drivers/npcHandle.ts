import type { Character } from '../classes/Character';
import type { NpcHandle } from './types';
import { debugLog } from '../utils/debugLog';

const BUBBLE_DURATION = 3.0;
const MIN_BUBBLE_DISPLAY = 2.0;

export function createNpcHandle(
  character: Character,
  sessionId = '',
): NpcHandle {
  const sid = sessionId;
  const logCmd = (cmd: string, extra = '') => {
    const qLen = character.commandQueueLength + 1;
    debugLog(
      sid, 'NPC_COMMAND',
      `enqueue ${cmd}${extra} queueLen=${qLen}`,
    );
  };

  return {
    gotoObject(type: string): void {
      logCmd('goto_object', ` objectType=${type}`);
      character.enqueueCommand({
        type: 'goto_object',
        objectType: type,
      });
    },

    enterRoom(): void {
      logCmd('enter_room');
      character.enqueueCommand({ type: 'enter_room' });
    },

    leaveRoom(): void {
      logCmd('leave_room');
      character.enqueueCommand({ type: 'leave_room' });
    },

    wander(): void {
      logCmd('wander');
      character.enqueueCommand({ type: 'wander' });
    },

    showBubble(
      text: string,
      bubbleType: 'speech' | 'thought',
      persist = false,
    ): void {
      if (
        !persist
        && character.bubbleText
        && character.bubbleAge < MIN_BUBBLE_DISPLAY
      ) {
        return;
      }
      character.bubbleText = text;
      character.bubbleType = bubbleType;
      character.bubbleAge = 0;
      if (persist) {
        character.bubblePersist = true;
        character.bubbleTimer = 1;
      } else {
        character.bubblePersist = false;
        character.bubbleTimer = BUBBLE_DURATION;
      }
    },

    setToolBubble(
      walking: string,
      arrived: string,
    ): void {
      character.externalBubble = { walking, arrived };
      if (
        !character.bubbleText
        || character.bubbleAge >= MIN_BUBBLE_DISPLAY
      ) {
        character.bubbleText = walking;
        character.bubbleType = 'thought';
        character.bubbleTimer = BUBBLE_DURATION;
        character.bubbleAge = 0;
      }
    },

    setWaitingForApproval(waiting: boolean): void {
      if (waiting) {
        character.waitingForApproval = true;
      } else if (character.waitingForApproval) {
        character.waitingForApproval = false;
        character.bubblePersist = false;
        character.bubbleText = null;
        character.bubbleTimer = 0;
      }
    },

    setInteracting(
      objectType: string,
      duration?: number,
    ): void {
      logCmd(
        'set_interacting',
        ` objectType=${objectType}`,
      );
      character.enqueueCommand({
        type: 'set_interacting',
        objectType,
        duration,
      });
    },

    cancelLeave(): void {
      logCmd('cancel_leave');
      character.cancelLeave();
    },

    isIdle(): boolean {
      return character.state === 'idle';
    },

    isWalking(): boolean {
      return character.state === 'walking';
    },
  };
}
