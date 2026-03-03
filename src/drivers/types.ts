export type NpcCommand =
  | { type: 'goto_object'; objectType: string }
  | { type: 'enter_room' }
  | { type: 'leave_room' }
  | { type: 'wander' }
  | {
    type: 'set_interacting';
    objectType: string;
    duration?: number;
  };

const MOVEMENT_COMMANDS = new Set<NpcCommand['type']>([
  'goto_object', 'wander', 'leave_room',
]);

export function isMovementCommand(cmd: NpcCommand): boolean {
  return MOVEMENT_COMMANDS.has(cmd.type);
}

export type AgentEventType =
  | 'session_start'
  | 'session_end'
  | 'prompt_submit'
  | 'tool_start'
  | 'tool_end'
  | 'turn_end'
  | 'permission_wait'
  | 'subagent_start'
  | 'subagent_end'
  | 'idle_notification'
  | 'elicitation_wait'
  | 'auth_success'
  | 'worktree_create'
  | 'worktree_remove'
  | 'teammate_idle'
  | 'task_completed';

export type AgentType = 'claude_code' | 'gemini' | 'codex';

export interface AgentEvent {
  sessionId: string;
  timestamp: number;
  type: AgentEventType;
  agentType: AgentType;
  payload: Record<string, unknown>;
}

export interface NpcHandle {
  gotoObject(type: string): void;
  enterRoom(): void;
  leaveRoom(): void;
  wander(): void;
  showBubble(
    text: string,
    type: 'speech' | 'thought',
    persist?: boolean,
  ): void;
  setToolBubble(walking: string, arrived: string): void;
  setWaitingForApproval(waiting: boolean): void;
  setInteracting(
    objectType: string,
    duration?: number,
  ): void;
  cancelLeave(): void;
  isIdle(): boolean;
  isWalking(): boolean;
}

export interface ActivityMessage {
  id: string;
  timestamp: number;
  side: 'agent' | 'user';
  text: string;
  fullText?: string;
}

export interface SubagentInfo {
  subagentSessionId: string;
  parentSessionId: string;
  nativeAgentId: string;
  transcriptPath: string;
}

export interface SessionStateFile {
  sessionId: string;
  timestamp: number;
  lastEventType: AgentEventType;
  agentType: AgentType;
  payload: Record<string, unknown>;
}
