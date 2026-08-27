import { heavyBackgroundJobHandlers } from './handlers-heavy';
import { lightBackgroundJobHandlers } from './handlers-light';
import type { BackgroundJobHandlers } from './worker';

export const backgroundJobHandlers: BackgroundJobHandlers = {
  ...lightBackgroundJobHandlers,
  ...heavyBackgroundJobHandlers,
};
