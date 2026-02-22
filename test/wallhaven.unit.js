/*
 * Copyright (C) 2026 Jagrit Gumber
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

const assert = require("assert");

const { parseRefreshTime, getNextRunAt, shouldCatchUpNow } = require("../dist/extension/wallhaven/scheduler");

// This file is intended for local sanity checks after build output exists.
// It is not wired to the extension host test harness.

const parsed = parseRefreshTime("09:30");
assert.ok(parsed);
assert.equal(parsed.hour, 9);
assert.equal(parsed.minute, 30);

const now = new Date(2026, 0, 1, 10, 0, 0, 0);
const next = getNextRunAt(now, "09:00");
assert.equal(next.getDate(), 2);

assert.equal(shouldCatchUpNow(new Date(2026, 0, 1, 11, 0, 0, 0), "09:00", undefined), true);
assert.equal(shouldCatchUpNow(new Date(2026, 0, 1, 8, 0, 0, 0), "09:00", undefined), false);
