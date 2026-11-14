import {
  loadReadingDays,
  loadWeeklyGoal,
  READING_DAYS_KEY,
  saveWeeklyGoal,
  WEEKLY_GOAL_KEY,
} from "./index-storage.js";

function localDateKey(date) {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function createReadingSummary({
  readingStreak,
  weeklyGoalSelect,
  weeklyGoalTrack,
  weeklyGoalFill,
  weeklyGoalCount,
}) {
  let weeklyGoal = loadWeeklyGoal();
  let refreshTimer;

  function render() {
    const now = new Date();
    const today = localDateKey(now);
    const readingDays = loadReadingDays();
    const readingDaySet = new Set(readingDays);
    const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (!readingDaySet.has(localDateKey(cursor))) {
      cursor.setDate(cursor.getDate() - 1);
    }

    let streak = 0;
    while (readingDaySet.has(localDateKey(cursor))) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }

    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayOfWeek = monday.getDay() || 7;
    monday.setDate(monday.getDate() - dayOfWeek + 1);
    const weekStart = localDateKey(monday);
    const daysThisWeek = readingDays.filter(
      (date) => date >= weekStart && date <= today,
    ).length;

    readingStreak.textContent = `${streak} ${streak === 1 ? "Day" : "Days"}`;
    weeklyGoalSelect.value = String(weeklyGoal);
    weeklyGoalTrack.setAttribute("aria-valuemax", String(weeklyGoal));
    weeklyGoalTrack.setAttribute(
      "aria-valuenow",
      String(Math.min(daysThisWeek, weeklyGoal)),
    );
    weeklyGoalTrack.setAttribute(
      "aria-valuetext",
      `${daysThisWeek} of ${weeklyGoal} days this week`,
    );
    weeklyGoalFill.style.width = `${Math.min(100, (daysThisWeek / weeklyGoal) * 100)}%`;
    weeklyGoalCount.textContent = `${daysThisWeek} / ${weeklyGoal} ${weeklyGoal === 1 ? "Day" : "Days"}`;
  }

  function scheduleRefresh() {
    window.clearTimeout(refreshTimer);
    const now = new Date();
    const nextMidnight = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
    );
    refreshTimer = window.setTimeout(
      () => {
        render();
        scheduleRefresh();
      },
      nextMidnight.getTime() - now.getTime() + 50,
    );
  }

  weeklyGoalSelect.addEventListener("change", () => {
    weeklyGoal = Number(weeklyGoalSelect.value);
    saveWeeklyGoal(weeklyGoal);
    render();
  });

  window.addEventListener("storage", (event) => {
    if (event.key === READING_DAYS_KEY) render();
    if (event.key === WEEKLY_GOAL_KEY) {
      weeklyGoal = loadWeeklyGoal();
      render();
    }
  });

  render();
  scheduleRefresh();
  return {
    render,
    refreshFromStorage() {
      weeklyGoal = loadWeeklyGoal();
      render();
    },
  };
}
