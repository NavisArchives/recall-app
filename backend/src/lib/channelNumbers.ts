// Numbers the display reserves for its own pages, so they can never be claimed
// by a content channel: 00 overview, 10 social, 98 home, 99 admin.
//
// 11 was here, for a screen that listed every instruction channel. It stopped
// being special on 21 Aug 2026 (045): an instruction IS a channel and already
// has its own number, so the menu duplicated the things it listed. 11 is
// ordinary content now.
export const RESERVED_CHANNEL_NUMBERS = new Set([0, 10, 98, 99]);
