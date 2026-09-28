// Scratch test script for phase logic
const getDaysBetween = (d1, d2) => {
  const t1 = new Date(d1).setHours(0,0,0,0);
  const t2 = new Date(d2).setHours(0,0,0,0);
  return Math.floor((t2 - t1) / (1000 * 60 * 60 * 24));
};

const getTodayString = () => '2026-09-28';

console.log("Testing date diff 2026-09-28 vs 2026-09-28:", getDaysBetween('2026-09-28', '2026-09-28'));
console.log("Testing date diff 2026-09-21 vs 2026-09-28:", getDaysBetween('2026-09-21', '2026-09-28'));
