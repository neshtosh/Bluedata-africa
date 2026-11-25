import { startStack } from './stack.js';

/** Starts the isolated stack once for the whole run; the returned function tears it down. */
export default async function globalSetup() {
  const stack = await startStack();
  return async () => {
    await stack.stop();
  };
}
