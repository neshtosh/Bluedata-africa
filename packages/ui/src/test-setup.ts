import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// Simulated typing in jsdom is slow when the machine is busy (e.g. the full pipeline runs
// Testcontainers suites and Next builds in parallel); wait longer before declaring failure.
configure({ asyncUtilTimeout: 5_000 });

afterEach(() => cleanup());
