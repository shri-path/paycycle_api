/**
 * VoiceIntentVO — structured interpretation of a voice command.
 * Pure domain, no framework imports.
 */
import { ArgumentInvalidException } from '@/common/errors/app-error';
import { VoiceIntentAction } from '../voice.types';

const VALID_ACTIONS = new Set(Object.values(VoiceIntentAction));
const NAME_REQUIRED = new Set<VoiceIntentAction>([
  VoiceIntentAction.MARK_DELIVERED,
  VoiceIntentAction.MARK_LEAVE,
]);

export interface VoiceIntentProps {
  action: VoiceIntentAction;
  customerName?: string | undefined;
  quantity?: number | undefined;
}

export class VoiceIntentVO {
  readonly action: VoiceIntentAction;
  readonly customerName: string | undefined;
  readonly quantity: number | undefined;

  private constructor(props: VoiceIntentProps) {
    this.action = props.action;
    this.customerName = props.customerName;
    this.quantity = props.quantity;
  }

  static create(props: VoiceIntentProps): VoiceIntentVO {
    if (!VALID_ACTIONS.has(props.action)) {
      throw new ArgumentInvalidException(`Invalid voice intent action: "${props.action}"`);
    }
    if (NAME_REQUIRED.has(props.action) && !props.customerName) {
      throw new ArgumentInvalidException(`customerName is required for action "${props.action}"`);
    }
    if (props.action === VoiceIntentAction.ADJUST_QUANTITY) {
      if (props.quantity === undefined || props.quantity <= 0) {
        throw new ArgumentInvalidException('quantity must be > 0 for ADJUST_QUANTITY');
      }
    }
    return new VoiceIntentVO(props);
  }

  /** Convenience factory for UNKNOWN intent (no validation needed). */
  static unknown(): VoiceIntentVO {
    return new VoiceIntentVO({ action: VoiceIntentAction.UNKNOWN });
  }
}
