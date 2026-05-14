export type TimeWindow = {
  enabled: boolean;
  start: string;
  end: string;
};

export const DEFAULT_TIME_WINDOW: TimeWindow = {
  enabled: true,
  start: "00:00",
  end: "23:59",
};

const isTimeValue = (value: unknown): value is string =>
  typeof value === "string" && /^\d{2}:\d{2}$/.test(value);

export const parseTimeWindow = (value?: string | null): TimeWindow => {
  if (!value) return DEFAULT_TIME_WINDOW;

  try {
    const parsed = JSON.parse(value) as Partial<TimeWindow>;
    return {
      enabled: parsed.enabled !== false,
      start: isTimeValue(parsed.start) ? parsed.start : DEFAULT_TIME_WINDOW.start,
      end: isTimeValue(parsed.end) ? parsed.end : DEFAULT_TIME_WINDOW.end,
    };
  } catch {
    return DEFAULT_TIME_WINDOW;
  }
};

const toMinutes = (value: string) => {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
};

export const isWithinTimeWindow = (window: TimeWindow, date = new Date()) => {
  if (!window.enabled) return true;

  const start = toMinutes(window.start);
  const end = toMinutes(window.end);
  const current = date.getHours() * 60 + date.getMinutes();

  if (start === end) return true;
  if (start < end) return current >= start && current <= end;
  return current >= start || current <= end;
};

export const formatTimeWindow = (window: TimeWindow) =>
  window.enabled ? `${window.start} - ${window.end}` : "durchgehend";
