import React, { useState, useEffect, useCallback, useMemo } from "react";

/* ---------------------------------------------------------
   WORKOUT — dark iron/brass workout log
   Palette: cast-iron black / bronze accent / chalk text
--------------------------------------------------------- */

const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600;700&display=swap');`;

const COLORS = {
  bg: "#121110",
  surface: "#1C1A17",
  surfaceRaised: "#232019",
  border: "#322D26",
  borderSoft: "#252220",
  text: "#ECE6DC",
  textSoft: "#968D7E",
  textMute: "#5C564C",
  accent: "#BA7132",
  accentDim: "#8A5726",
  accentSoft: "rgba(186,113,50,0.14)",
  success: "#7A9463",
  danger: "#A65442",
};

const BODY_PARTS = [
  { id: "chest", label: "胸" },
  { id: "back", label: "背中" },
  { id: "shoulders", label: "肩" },
  { id: "arms", label: "腕" },
  { id: "legs", label: "脚" },
  { id: "core", label: "腹筋" },
  { id: "cardio", label: "有酸素" },
];

const DEFAULT_EXERCISES = {
  chest: ["ベンチプレス", "インクラインベンチプレス", "ダンベルフライ", "ケーブルクロスオーバー", "腕立て伏せ"],
  back: ["デッドリフト", "懸垂", "ラットプルダウン", "ベントオーバーロウ", "シーテッドロウ"],
  shoulders: ["ショルダープレス", "サイドレイズ", "リアレイズ", "アップライトロウ"],
  arms: ["バーベルカール", "ダンベルカール", "トライセプスエクステンション", "ケーブルプッシュダウン"],
  legs: ["スクワット", "レッグプレス", "レッグエクステンション", "レッグカール", "カーフレイズ"],
  core: ["クランチ", "レッグレイズ", "プランク", "ロシアンツイスト"],
  cardio: ["ランニング", "ウォーキング", "エアロバイク", "エリプティカル"],
};

const DEFAULT_BODY_WEIGHT = 60;

/* ---------- date / grid helpers ---------- */
function todayStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function formatDateLabel(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const w = ["日", "月", "火", "水", "木", "金", "土"][d.getDay()];
  return `${d.getMonth() + 1}月${d.getDate()}日(${w})`;
}
function daysAgoLabel(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const t = new Date(todayStr() + "T00:00:00");
  const diff = Math.round((t - d) / 86400000);
  if (diff === 0) return "今日";
  if (diff === 1) return "1日前";
  if (diff < 0) return "";
  return `${diff}日前`;
}
function ymOf(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return { year: d.getFullYear(), month: d.getMonth() };
}
function monthGrid(year, month) {
  const first = new Date(year, month, 1);
  const leadOffset = first.getDay();
  const gridStart = new Date(year, month, 1 - leadOffset);
  const weeks = [];
  let cursor = new Date(gridStart);
  for (let w = 0; w < 6; w++) {
    const week = [];
    for (let i = 0; i < 7; i++) {
      week.push({ dateStr: todayStr(cursor), inMonth: cursor.getMonth() === month });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
    if (cursor.getMonth() !== month) break;
  }
  return weeks;
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return todayStr(d);
}

/* ---------- volume / stats helpers ---------- */
function volumeOfDay(logs, dateStr) {
  const entries = logs[dateStr];
  if (!entries) return 0;
  return entries.reduce(
    (sum, e) =>
      sum +
      (e.bodyPart === "cardio"
        ? 0
        : e.sets.reduce((s, st) => s + (Number(st.weight) || 0) * (Number(st.reps) || 0), 0)),
    0
  );
}
function estOneRM(weight, reps, bw) {
  if (bw || !weight || !reps) return 0;
  return Math.round(weight * (1 + reps / 40) * 10) / 10;
}
function dayCounts(entries) {
  const exerciseCount = entries.length;
  let setCount = 0;
  let repCount = 0;
  entries.forEach((e) => {
    setCount += e.sets.length;
    if (e.bodyPart !== "cardio") {
      repCount += e.sets.reduce((s, st) => s + (Number(st.reps) || 0), 0);
    }
  });
  return { exerciseCount, setCount, repCount };
}
// ACSM metabolic equation estimate for treadmill walking/running
function calcCardio(speedKmh, inclinePercent, durationMin, weightKg) {
  const sp = Number(speedKmh) || 0;
  const inc = Number(inclinePercent) || 0;
  const dur = Number(durationMin) || 0;
  if (sp <= 0 || dur <= 0) return { distance: 0, calories: 0 };
  const speedMMin = (sp * 1000) / 60;
  const grade = inc / 100;
  const vo2 =
    sp >= 6.4 ? 0.2 * speedMMin + 0.9 * speedMMin * grade + 3.5 : 0.1 * speedMMin + 1.8 * speedMMin * grade + 3.5;
  const mets = vo2 / 3.5;
  const kcalPerMin = (mets * 3.5 * (weightKg || DEFAULT_BODY_WEIGHT)) / 200;
  const calories = kcalPerMin * dur;
  const distance = sp * (dur / 60);
  return { distance, calories };
}

/* ---------- storage helpers ---------- */
async function loadAll() {
  const result = { logs: {}, exercises: null, bodyWeightKg: DEFAULT_BODY_WEIGHT, goalsMemo: "" };
  try {
    const logsRes = await window.storage.get("workout-logs", false);
    if (logsRes && logsRes.value) result.logs = JSON.parse(logsRes.value);
  } catch (e) {}
  try {
    const exRes = await window.storage.get("exercises", false);
    if (exRes && exRes.value) result.exercises = JSON.parse(exRes.value);
  } catch (e) {}
  try {
    const wRes = await window.storage.get("body-weight-kg", false);
    if (wRes && wRes.value) result.bodyWeightKg = Number(wRes.value) || DEFAULT_BODY_WEIGHT;
  } catch (e) {}
  try {
    const gRes = await window.storage.get("goals-memo", false);
    if (gRes && gRes.value) result.goalsMemo = gRes.value;
  } catch (e) {}
  return result;
}
async function saveLogs(logs) {
  try {
    await window.storage.set("workout-logs", JSON.stringify(logs), false);
  } catch (e) {}
}
async function saveExercises(ex) {
  try {
    await window.storage.set("exercises", JSON.stringify(ex), false);
  } catch (e) {}
}
async function saveBodyWeight(kg) {
  try {
    await window.storage.set("body-weight-kg", String(kg), false);
  } catch (e) {}
}
async function saveGoalsMemo(text) {
  try {
    await window.storage.set("goals-memo", text, false);
  } catch (e) {}
}

/* ---------- small UI atoms ---------- */
function IconPlate({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke={COLORS.accent} strokeWidth="2" />
      <circle cx="12" cy="12" r="3.2" fill={COLORS.accent} />
    </svg>
  );
}
function IconBack({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M15 5L8 12l7 7" stroke={COLORS.text} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconTrash({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M4 6h16M9 6V4h6v2M6 6l1 14h10l1-14" stroke={COLORS.textSoft} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconPlus({ size = 18, color = COLORS.bg }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M12 5v14M5 12h14" stroke={color} strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}
function IconClose({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M6 6l12 12M18 6L6 18" stroke={COLORS.textSoft} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
function IconChevron({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M9 6l6 6-6 6" stroke={COLORS.textSoft} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconGear({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="3" stroke={COLORS.textSoft} strokeWidth="1.8" />
      <path
        d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"
        stroke={COLORS.textSoft}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
function IconArrowUp({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M12 19V5M6 11l6-6 6 6" stroke={COLORS.textSoft} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconArrowDown({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M12 5v14M6 13l6 6 6-6" stroke={COLORS.textSoft} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ---------- plate stack visual (signature element) ---------- */
function PlateBar({ weight, maxWeight }) {
  const ratio = maxWeight > 0 ? Math.min(1, weight / maxWeight) : 0;
  const plateCount = weight <= 0 ? 0 : Math.max(1, Math.round(ratio * 5) + 1);
  const heights = [26, 32, 38, 32, 26];
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 40 }}>
      <div style={{ width: 14, height: 4, background: COLORS.textMute, borderRadius: 2, marginRight: 2 }} />
      {Array.from({ length: Math.min(plateCount, 5) }).map((_, i) => (
        <div
          key={i}
          style={{
            width: 6,
            height: heights[i] || 30,
            background: COLORS.accent,
            borderRadius: 1.5,
            opacity: 0.55 + i * 0.09,
          }}
        />
      ))}
    </div>
  );
}

const inputStyle = {
  width: "100%",
  background: COLORS.bg,
  border: `1px solid ${COLORS.border}`,
  borderRadius: 8,
  color: COLORS.text,
  fontSize: 16,
  fontFamily: "Inter, sans-serif",
  padding: "8px 10px",
  outline: "none",
};
const noteInputStyle = {
  ...inputStyle,
  fontSize: 13,
  padding: "7px 10px",
  color: COLORS.textSoft,
};
const bwToggleStyle = {
  flexShrink: 0,
  background: "transparent",
  border: `1px solid ${COLORS.border}`,
  borderRadius: 6,
  color: COLORS.textMute,
  fontSize: 11,
  padding: "6px 7px",
  cursor: "pointer",
  fontFamily: "Inter, sans-serif",
  whiteSpace: "nowrap",
};
const iconBtnStyle = {
  background: "transparent",
  border: "none",
  padding: 6,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

/* ---------- Set row editor (weight training) ---------- */
function SetRow({ index, set, onChange, onRemove, prevSet }) {
  const isBW = !!set.bw;
  const toggleBW = () => {
    if (isBW) onChange({ ...set, bw: false });
    else onChange({ ...set, bw: true, weight: "" });
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0" }}>
      <div style={{ width: 22, fontFamily: "Bebas Neue, Inter, sans-serif", fontSize: 15, color: COLORS.textMute, letterSpacing: 0.5 }}>
        {String(index + 1).padStart(2, "0")}
      </div>
      <div style={{ flex: 1.3, display: "flex", alignItems: "center", gap: 6 }}>
        {isBW ? (
          <button
            onClick={toggleBW}
            style={{
              width: "100%",
              background: COLORS.accentSoft,
              border: `1px solid ${COLORS.accentDim}`,
              borderRadius: 8,
              color: COLORS.accent,
              fontSize: 14,
              fontFamily: "Inter, sans-serif",
              fontWeight: 600,
              padding: "8px 6px",
              cursor: "pointer",
            }}
          >
            自重
          </button>
        ) : (
          <input
            type="number"
            inputMode="decimal"
            value={set.weight}
            onChange={(e) => onChange({ ...set, weight: e.target.value })}
            placeholder={prevSet ? (prevSet.bw ? "自重" : String(prevSet.weight)) : "0"}
            style={inputStyle}
          />
        )}
        {!isBW && <span style={{ color: COLORS.textMute, fontSize: 12 }}>kg</span>}
        {!isBW && (
          <button onClick={toggleBW} style={bwToggleStyle} aria-label="自重に切り替え">
            自重
          </button>
        )}
      </div>
      <span style={{ color: COLORS.textMute, fontSize: 13 }}>×</span>
      <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6 }}>
        <input
          type="number"
          inputMode="numeric"
          value={set.reps}
          onChange={(e) => onChange({ ...set, reps: e.target.value })}
          placeholder={prevSet ? String(prevSet.reps) : "0"}
          style={inputStyle}
        />
        <span style={{ color: COLORS.textMute, fontSize: 12 }}>回</span>
      </div>
      <button onClick={onRemove} style={iconBtnStyle} aria-label="セットを削除">
        <IconTrash />
      </button>
    </div>
  );
}

/* ---------- Cardio session row ---------- */
function CardioSetRow({ index, set, onChange, onRemove, bodyWeightKg }) {
  const { distance, calories } = calcCardio(set.speed, set.incline, set.duration, bodyWeightKg);
  return (
    <div style={{ padding: "8px 0", borderBottom: `1px solid ${COLORS.borderSoft}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{ width: 22, fontFamily: "Bebas Neue, Inter, sans-serif", fontSize: 15, color: COLORS.textMute }}>
          {String(index + 1).padStart(2, "0")}
        </div>
        <div style={{ flex: 1 }}>
          <input
            type="number"
            inputMode="decimal"
            value={set.speed}
            onChange={(e) => onChange({ ...set, speed: e.target.value })}
            placeholder="速度"
            style={inputStyle}
          />
          <div style={{ fontSize: 10, color: COLORS.textMute, marginTop: 2, textAlign: "center" }}>km/h</div>
        </div>
        <div style={{ flex: 1 }}>
          <input
            type="number"
            inputMode="decimal"
            value={set.incline}
            onChange={(e) => onChange({ ...set, incline: e.target.value })}
            placeholder="傾斜"
            style={inputStyle}
          />
          <div style={{ fontSize: 10, color: COLORS.textMute, marginTop: 2, textAlign: "center" }}>%</div>
        </div>
        <div style={{ flex: 1 }}>
          <input
            type="number"
            inputMode="numeric"
            value={set.duration}
            onChange={(e) => onChange({ ...set, duration: e.target.value })}
            placeholder="時間"
            style={inputStyle}
          />
          <div style={{ fontSize: 10, color: COLORS.textMute, marginTop: 2, textAlign: "center" }}>分</div>
        </div>
        <button onClick={onRemove} style={iconBtnStyle} aria-label="セッションを削除">
          <IconTrash />
        </button>
      </div>
      {(distance > 0 || calories > 0) && (
        <div style={{ display: "flex", gap: 14, marginTop: 6, paddingLeft: 28 }}>
          <span style={{ fontSize: 12, color: COLORS.accent }}>{distance.toFixed(2)} km</span>
          <span style={{ fontSize: 12, color: COLORS.accent }}>約{Math.round(calories)} kcal</span>
        </div>
      )}
    </div>
  );
}

/* ---------- Exercise logging card (weight training) ---------- */
function ExerciseCard({ entry, prevEntry, onUpdate, onDelete }) {
  const sets = entry.sets;
  const bestSet = sets.reduce((a, s) => (!s.bw && Number(s.weight) > Number(a.weight || 0) ? s : a), { weight: 0 });
  const maxWeight = Math.max(
    1,
    Number(bestSet.weight) || 1,
    ...(prevEntry ? prevEntry.sets.filter((s) => !s.bw).map((s) => Number(s.weight) || 0) : [0])
  );
  const bestRM = sets.reduce((m, s) => Math.max(m, estOneRM(Number(s.weight), Number(s.reps), s.bw)), 0);
  const allBW = sets.length > 0 && sets.every((s) => s.bw);

  const updateSet = (i, newSet) => {
    const newSets = sets.slice();
    newSets[i] = newSet;
    onUpdate({ ...entry, sets: newSets });
  };
  const removeSet = (i) => {
    onUpdate({ ...entry, sets: sets.filter((_, idx) => idx !== i) });
  };
  const addSet = () => {
    const last = sets[sets.length - 1];
    onUpdate({
      ...entry,
      sets: [
        ...sets,
        { weight: last && !last.bw ? last.weight : "", reps: last ? last.reps : "", bw: last ? !!last.bw : false },
      ],
    });
  };

  return (
    <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.borderSoft}`, borderRadius: 12, padding: "14px 14px 10px", marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 11, color: COLORS.accent, letterSpacing: 1, marginBottom: 2 }}>
            {BODY_PARTS.find((b) => b.id === entry.bodyPart)?.label || ""}
          </div>
          <div style={{ fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 17, color: COLORS.text }}>
            {entry.exerciseName}
          </div>
          {prevEntry && (
            <div style={{ marginTop: 4 }}>
              <div style={{ fontSize: 10, color: COLORS.textMute, letterSpacing: 0.5 }}>前回</div>
              {prevEntry.sets.map((s, i) => (
                <div key={i} style={{ fontSize: 12, color: COLORS.textSoft }}>
                  {i + 1}　{s.bw ? "自重" : `${s.weight || 0}kg`} × {s.reps || 0}
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {bestRM > 0 && (
            <div style={{ textAlign: "right" }}>
              <div style={{ fontFamily: "Bebas Neue, Inter, sans-serif", fontSize: 20, color: COLORS.accent, lineHeight: 1 }}>
                {bestRM.toFixed(1)}
              </div>
              <div style={{ fontSize: 9, color: COLORS.textMute, letterSpacing: 0.5 }}>推定1RM</div>
            </div>
          )}
          {!allBW && <PlateBar weight={Number(bestSet.weight) || 0} maxWeight={maxWeight} />}
        </div>
      </div>

      <div style={{ marginTop: 8, borderTop: `1px solid ${COLORS.borderSoft}` }}>
        {sets.map((s, i) => (
          <SetRow key={i} index={i} set={s} prevSet={prevEntry && prevEntry.sets[i]} onChange={(ns) => updateSet(i, ns)} onRemove={() => removeSet(i)} />
        ))}
      </div>

      <div style={{ marginTop: 8 }}>
        <input
          value={entry.note || ""}
          onChange={(e) => onUpdate({ ...entry, note: e.target.value })}
          placeholder="コツ・メモを1行で..."
          style={noteInputStyle}
        />
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
        <button
          onClick={addSet}
          style={{ background: "transparent", border: `1px dashed ${COLORS.border}`, borderRadius: 8, color: COLORS.textSoft, fontSize: 13, padding: "6px 12px", cursor: "pointer", fontFamily: "Inter, sans-serif" }}
        >
          + セット追加
        </button>
        <button onClick={onDelete} style={{ background: "transparent", border: "none", color: COLORS.textMute, fontSize: 12, cursor: "pointer" }}>
          種目を削除
        </button>
      </div>
    </div>
  );
}

/* ---------- Cardio logging card ---------- */
function CardioCard({ entry, prevEntry, onUpdate, onDelete, bodyWeightKg }) {
  const sets = entry.sets;
  const updateSet = (i, newSet) => {
    const newSets = sets.slice();
    newSets[i] = newSet;
    onUpdate({ ...entry, sets: newSets });
  };
  const removeSet = (i) => onUpdate({ ...entry, sets: sets.filter((_, idx) => idx !== i) });
  const addSet = () => onUpdate({ ...entry, sets: [...sets, { speed: "", incline: "", duration: "" }] });

  const totals = sets.reduce(
    (acc, s) => {
      const r = calcCardio(s.speed, s.incline, s.duration, bodyWeightKg);
      return { distance: acc.distance + r.distance, calories: acc.calories + r.calories };
    },
    { distance: 0, calories: 0 }
  );

  return (
    <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.borderSoft}`, borderRadius: 12, padding: "14px 14px 10px", marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 11, color: COLORS.accent, letterSpacing: 1, marginBottom: 2 }}>有酸素</div>
          <div style={{ fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 17, color: COLORS.text }}>{entry.exerciseName}</div>
          {prevEntry && (
            <div style={{ marginTop: 4 }}>
              <div style={{ fontSize: 10, color: COLORS.textMute, letterSpacing: 0.5 }}>前回</div>
              {prevEntry.sets.map((s, i) => (
                <div key={i} style={{ fontSize: 12, color: COLORS.textSoft }}>
                  {i + 1}　{s.speed || 0}km/h ・ 傾斜{s.incline || 0}% ・ {s.duration || 0}分
                </div>
              ))}
            </div>
          )}
        </div>
        {(totals.distance > 0 || totals.calories > 0) && (
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: "Bebas Neue, Inter, sans-serif", fontSize: 20, color: COLORS.accent, lineHeight: 1 }}>
              {totals.distance.toFixed(1)}
            </div>
            <div style={{ fontSize: 9, color: COLORS.textMute, letterSpacing: 0.5 }}>km ・ 約{Math.round(totals.calories)}kcal</div>
          </div>
        )}
      </div>

      <div style={{ marginTop: 8 }}>
        {sets.map((s, i) => (
          <CardioSetRow key={i} index={i} set={s} bodyWeightKg={bodyWeightKg} onChange={(ns) => updateSet(i, ns)} onRemove={() => removeSet(i)} />
        ))}
      </div>

      <div style={{ marginTop: 8 }}>
        <input
          value={entry.note || ""}
          onChange={(e) => onUpdate({ ...entry, note: e.target.value })}
          placeholder="コツ・メモを1行で..."
          style={noteInputStyle}
        />
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
        <button
          onClick={addSet}
          style={{ background: "transparent", border: `1px dashed ${COLORS.border}`, borderRadius: 8, color: COLORS.textSoft, fontSize: 13, padding: "6px 12px", cursor: "pointer", fontFamily: "Inter, sans-serif" }}
        >
          + セッション追加
        </button>
        <button onClick={onDelete} style={{ background: "transparent", border: "none", color: COLORS.textMute, fontSize: 12, cursor: "pointer" }}>
          種目を削除
        </button>
      </div>
    </div>
  );
}

/* ---------- Exercise picker ---------- */
function ExercisePicker({ allExercises, onPick, onClose, onOpenSettings }) {
  const [part, setPart] = useState("chest");
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(8,7,6,0.72)", display: "flex", alignItems: "flex-end", zIndex: 50 }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: COLORS.surface, borderTop: `1px solid ${COLORS.border}`, borderRadius: "16px 16px 0 0", width: "100%", maxHeight: "80vh", overflowY: "auto", padding: "16px 16px 24px" }}
      >
        <div style={{ width: 36, height: 4, background: COLORS.border, borderRadius: 2, margin: "0 auto 14px" }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <span style={{ fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 16, color: COLORS.text }}>種目を選択</span>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button onClick={onOpenSettings} style={{ ...iconBtnStyle, display: "flex", alignItems: "center", gap: 4 }}>
              <IconGear size={16} />
              <span style={{ fontSize: 12, color: COLORS.textSoft }}>編集</span>
            </button>
            <button onClick={onClose} style={iconBtnStyle} aria-label="閉じる">
              <IconClose size={20} />
            </button>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 12, marginBottom: 8 }}>
          {BODY_PARTS.map((b) => (
            <button
              key={b.id}
              onClick={() => setPart(b.id)}
              style={{
                flexShrink: 0,
                padding: "7px 14px",
                borderRadius: 20,
                border: `1px solid ${part === b.id ? COLORS.accent : COLORS.border}`,
                background: part === b.id ? COLORS.accentSoft : "transparent",
                color: part === b.id ? COLORS.accent : COLORS.textSoft,
                fontSize: 13,
                fontFamily: "Inter, sans-serif",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {b.label}
            </button>
          ))}
        </div>
        <div>
          {(allExercises[part] || []).map((name) => (
            <button
              key={name}
              onClick={() => onPick(part, name)}
              style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: "none", borderBottom: `1px solid ${COLORS.borderSoft}`, padding: "13px 4px", color: COLORS.text, fontSize: 15, fontFamily: "Inter, sans-serif", cursor: "pointer" }}
            >
              {name}
            </button>
          ))}
          {(allExercises[part] || []).length === 0 && (
            <div style={{ color: COLORS.textMute, fontSize: 13, padding: "16px 4px" }}>
              種目がありません。「編集」から追加してください。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- Settings modal: manage exercise list + body weight ---------- */
function SettingsModal({ exercises, onSave, bodyWeightKg, onSaveBodyWeight, onClose }) {
  const [part, setPart] = useState("chest");
  const [localExercises, setLocalExercises] = useState(exercises);
  const [localWeight, setLocalWeight] = useState(String(bodyWeightKg));
  const [newName, setNewName] = useState("");

  const list = localExercises[part] || [];

  const commit = (nextList) => {
    const next = { ...localExercises, [part]: nextList };
    setLocalExercises(next);
    onSave(next);
  };
  const removeItem = (i) => commit(list.filter((_, idx) => idx !== i));
  const moveItem = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const next = list.slice();
    [next[i], next[j]] = [next[j], next[i]];
    commit(next);
  };
  const addItem = () => {
    if (!newName.trim()) return;
    commit([...list, newName.trim()]);
    setNewName("");
  };
  const commitWeight = () => {
    const n = Number(localWeight);
    if (n > 0) onSaveBodyWeight(n);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(8,7,6,0.72)", display: "flex", alignItems: "flex-end", zIndex: 60 }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: COLORS.surface, borderTop: `1px solid ${COLORS.border}`, borderRadius: "16px 16px 0 0", width: "100%", maxHeight: "85vh", overflowY: "auto", padding: "16px 16px 28px" }}
      >
        <div style={{ width: 36, height: 4, background: COLORS.border, borderRadius: 2, margin: "0 auto 14px" }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <span style={{ fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 16, color: COLORS.text }}>設定</span>
          <button onClick={onClose} style={iconBtnStyle} aria-label="閉じる">
            <IconClose size={20} />
          </button>
        </div>

        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 12, color: COLORS.textMute, marginBottom: 6 }}>体重（有酸素の消費カロリー計算に使用）</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input type="number" inputMode="decimal" value={localWeight} onChange={(e) => setLocalWeight(e.target.value)} onBlur={commitWeight} style={{ ...inputStyle, flex: 1 }} />
            <span style={{ alignSelf: "center", color: COLORS.textMute, fontSize: 13 }}>kg</span>
          </div>
        </div>

        <div style={{ fontSize: 12, color: COLORS.textMute, marginBottom: 6 }}>種目リストの編集</div>
        <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 12, marginBottom: 8 }}>
          {BODY_PARTS.map((b) => (
            <button
              key={b.id}
              onClick={() => setPart(b.id)}
              style={{
                flexShrink: 0,
                padding: "7px 14px",
                borderRadius: 20,
                border: `1px solid ${part === b.id ? COLORS.accent : COLORS.border}`,
                background: part === b.id ? COLORS.accentSoft : "transparent",
                color: part === b.id ? COLORS.accent : COLORS.textSoft,
                fontSize: 13,
                fontFamily: "Inter, sans-serif",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {b.label}
            </button>
          ))}
        </div>

        <div>
          {list.map((name, i) => (
            <div key={name + i} style={{ display: "flex", alignItems: "center", gap: 4, borderBottom: `1px solid ${COLORS.borderSoft}`, padding: "8px 0" }}>
              <span style={{ flex: 1, color: COLORS.text, fontSize: 14, fontFamily: "Inter, sans-serif" }}>{name}</span>
              <button onClick={() => moveItem(i, -1)} disabled={i === 0} style={{ ...iconBtnStyle, opacity: i === 0 ? 0.3 : 1 }} aria-label="上へ">
                <IconArrowUp />
              </button>
              <button onClick={() => moveItem(i, 1)} disabled={i === list.length - 1} style={{ ...iconBtnStyle, opacity: i === list.length - 1 ? 0.3 : 1 }} aria-label="下へ">
                <IconArrowDown />
              </button>
              <button onClick={() => removeItem(i)} style={iconBtnStyle} aria-label="削除">
                <IconTrash />
              </button>
            </div>
          ))}
          {list.length === 0 && <div style={{ color: COLORS.textMute, fontSize: 13, padding: "10px 0" }}>種目がありません</div>}
        </div>

        <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="新しい種目名..." style={{ ...inputStyle, flex: 1 }} />
          <button onClick={addItem} style={{ background: COLORS.accent, border: "none", borderRadius: 8, width: 44, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <IconPlus />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Goals memo card ---------- */
function GoalsMemo({ value, onSave }) {
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  useEffect(() => setText(value), [value]);

  return (
    <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.borderSoft}`, borderRadius: 14, padding: "12px 14px", marginBottom: 12 }}>
      <button onClick={() => setOpen(!open)} style={{ width: "100%", background: "transparent", border: "none", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", padding: 0 }}>
        <span style={{ fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 14, color: COLORS.text }}>目標メモ</span>
        <span style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s" }}>
          <IconChevron size={16} />
        </span>
      </button>
      {!open && text && (
        <div style={{ fontSize: 12, color: COLORS.textMute, marginTop: 6, whiteSpace: "pre-wrap", overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
          {text}
        </div>
      )}
      {!open && !text && <div style={{ fontSize: 12, color: COLORS.textMute, marginTop: 6 }}>部位サイクルやBIG3の目標などを記録できます</div>}
      {open && (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => onSave(text)}
          placeholder={"例）\n部位サイクル: 胸→背中→脚→肩→腕→休み\nBIG3目標: BP 90kg / SQ 120kg / DL 140kg"}
          rows={4}
          style={{ ...inputStyle, marginTop: 10, resize: "vertical", fontSize: 13, lineHeight: 1.6 }}
        />
      )}
    </div>
  );
}

/* ---------- History view ---------- */
function HistoryView({ logs, onSelectDate }) {
  const dates = Object.keys(logs).sort((a, b) => (a < b ? 1 : -1));
  if (dates.length === 0) {
    return <EmptyState title="記録がまだありません" body="トレーニングを記録すると、ここに日付ごとの履歴が並びます。" />;
  }
  return (
    <div>
      {dates.map((date) => {
        const entries = logs[date];
        const totalVolume = volumeOfDay(logs, date);
        const parts = [...new Set(entries.map((e) => BODY_PARTS.find((b) => b.id === e.bodyPart)?.label))];
        return (
          <button
            key={date}
            onClick={() => onSelectDate(date)}
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", textAlign: "left", background: COLORS.surface, border: `1px solid ${COLORS.borderSoft}`, borderRadius: 12, padding: "14px 16px", marginBottom: 10, cursor: "pointer" }}
          >
            <div>
              <div style={{ color: COLORS.text, fontFamily: "Inter, sans-serif", fontWeight: 600, fontSize: 15 }}>{formatDateLabel(date)}</div>
              <div style={{ color: COLORS.textMute, fontSize: 12, marginTop: 3 }}>
                {parts.join(" ・ ")}　{entries.length}種目
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontFamily: "Bebas Neue, Inter, sans-serif", fontSize: 22, color: COLORS.accent, lineHeight: 1 }}>{totalVolume.toLocaleString()}</div>
              <div style={{ fontSize: 9, color: COLORS.textMute, letterSpacing: 0.5 }}>総負荷量(kg)</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function EmptyState({ title, body }) {
  return (
    <div style={{ textAlign: "center", padding: "60px 20px", color: COLORS.textMute }}>
      <div style={{ marginBottom: 14, display: "flex", justifyContent: "center" }}>
        <IconPlate size={34} />
      </div>
      <div style={{ color: COLORS.textSoft, fontFamily: "Inter, sans-serif", fontWeight: 600, fontSize: 15, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 13, lineHeight: 1.6 }}>{body}</div>
    </div>
  );
}

/* ---------- Month calendar ---------- */
function MonthCalendar({ monthCursor, setMonthCursor, logs, selectedDate, onSelectDate }) {
  const { year, month } = monthCursor;
  const weeks = useMemo(() => monthGrid(year, month), [year, month]);
  const monthLabel = `${year}年${month + 1}月`;
  const todayS = todayStr();

  const goPrev = () => {
    const m = month === 0 ? 11 : month - 1;
    const y = month === 0 ? year - 1 : year;
    setMonthCursor({ year: y, month: m });
  };
  const goNext = () => {
    const m = month === 11 ? 0 : month + 1;
    const y = month === 11 ? year + 1 : year;
    setMonthCursor({ year: y, month: m });
  };

  return (
    <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.borderSoft}`, borderRadius: 14, padding: "14px 12px", marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, padding: "0 4px" }}>
        <button onClick={goPrev} style={{ ...iconBtnStyle, transform: "rotate(180deg)" }} aria-label="前の月">
          <IconChevron />
        </button>
        <span style={{ fontFamily: "Bebas Neue, Inter, sans-serif", fontSize: 20, letterSpacing: 1, color: COLORS.text }}>{monthLabel}</span>
        <button onClick={goNext} style={iconBtnStyle} aria-label="次の月">
          <IconChevron />
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", marginBottom: 4 }}>
        {["日", "月", "火", "水", "木", "金", "土"].map((w, i) => (
          <div key={w} style={{ textAlign: "center", fontSize: 11, color: i === 0 ? COLORS.danger : i === 6 ? COLORS.textSoft : COLORS.textMute, paddingBottom: 6 }}>
            {w}
          </div>
        ))}
      </div>

      {weeks.map((week, wi) => (
        <div key={wi} style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)" }}>
          {week.map((cell) => {
            const trained = !!logs[cell.dateStr];
            const isToday = cell.dateStr === todayS;
            const isSelected = cell.dateStr === selectedDate;
            return (
              <button key={cell.dateStr} onClick={() => cell.inMonth && onSelectDate(cell.dateStr)} disabled={!cell.inMonth} style={{ background: "transparent", border: "none", padding: "3px 0", cursor: cell.inMonth ? "pointer" : "default" }}>
                <div
                  style={{
                    width: 30,
                    height: 30,
                    margin: "0 auto",
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 13,
                    fontFamily: "Inter, sans-serif",
                    fontWeight: isSelected ? 700 : 500,
                    color: !cell.inMonth ? COLORS.textMute : isSelected ? COLORS.bg : COLORS.text,
                    background: isSelected ? COLORS.accent : "transparent",
                    border: trained && !isSelected ? `1.5px solid ${COLORS.accent}` : isToday && !isSelected ? `1px solid ${COLORS.textMute}` : "1.5px solid transparent",
                    opacity: cell.inMonth ? 1 : 0.35,
                  }}
                >
                  {Number(cell.dateStr.slice(-2))}
                </div>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}


function ArchiveRow({ logs, monthCursor }) {
  const monthCount = useMemo(() => {
    const prefix = `${monthCursor.year}-${String(monthCursor.month + 1).padStart(2, "0")}`;
    return Object.keys(logs).filter((d) => d.startsWith(prefix)).length;
  }, [logs, monthCursor]);
  const totalCount = Object.keys(logs).length;

  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: COLORS.surface, border: `1px solid ${COLORS.borderSoft}`, borderRadius: 14, padding: "14px 16px", marginBottom: 12 }}>
      <div>
        <div style={{ fontSize: 11, color: COLORS.textMute, letterSpacing: 0.5 }}>今月のトレーニング日数</div>
        <div style={{ fontFamily: "Bebas Neue, Inter, sans-serif", fontSize: 24, color: COLORS.text }}>
          {monthCount} <span style={{ fontSize: 11, color: COLORS.textMute, fontFamily: "Inter, sans-serif" }}>日</span>
        </div>
      </div>
      <div style={{ width: 1, height: 30, background: COLORS.borderSoft }} />
      <div style={{ textAlign: "right" }}>
        <div style={{ fontSize: 11, color: COLORS.textMute, letterSpacing: 0.5 }}>累計トレーニング日数</div>
        <div style={{ fontFamily: "Bebas Neue, Inter, sans-serif", fontSize: 24, color: COLORS.text }}>
          {totalCount} <span style={{ fontSize: 11, color: COLORS.textMute, fontFamily: "Inter, sans-serif" }}>日</span>
        </div>
      </div>
    </div>
  );
}

/* ---------- Day stats row (replaces per-day volume) ---------- */
function DayStatsRow({ entries }) {
  const { exerciseCount, setCount, repCount } = dayCounts(entries);
  const stats = [
    { label: "種目数", value: exerciseCount },
    { label: "セット数", value: setCount },
    { label: "レップ数", value: repCount },
  ];
  return (
    <div style={{ textAlign: "right" }}>
      <div style={{ display: "flex", gap: 12 }}>
        {stats.map((s) => (
          <div key={s.label}>
            <div style={{ fontFamily: "Bebas Neue, Inter, sans-serif", fontSize: 18, color: COLORS.accent, lineHeight: 1 }}>{s.value}</div>
            <div style={{ fontSize: 9, color: COLORS.textMute, letterSpacing: 0.5 }}>{s.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Main App ---------- */
export default function KintoreMemo() {
  const [logs, setLogs] = useState({});
  const [exercises, setExercises] = useState(DEFAULT_EXERCISES);
  const [bodyWeightKg, setBodyWeightKg] = useState(DEFAULT_BODY_WEIGHT);
  const [goalsMemo, setGoalsMemo] = useState("");
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("log"); // log | history
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [viewingPastDate, setViewingPastDate] = useState(null);
  const [monthCursor, setMonthCursor] = useState(ymOf(todayStr()));

  useEffect(() => {
    (async () => {
      const loaded = await loadAll();
      setLogs(loaded.logs);
      if (loaded.exercises) {
        setExercises(loaded.exercises);
      } else {
        setExercises(DEFAULT_EXERCISES);
        saveExercises(DEFAULT_EXERCISES);
      }
      setBodyWeightKg(loaded.bodyWeightKg);
      setGoalsMemo(loaded.goalsMemo);
      setLoading(false);
    })();
  }, []);

  const persistLogs = useCallback((next) => {
    setLogs(next);
    saveLogs(next);
  }, []);

  const activeDate = viewingPastDate || selectedDate;
  const entriesForDate = logs[activeDate] || [];

  const handleSelectDate = (d) => {
    if (d === todayStr()) {
      setViewingPastDate(null);
      setSelectedDate(d);
    } else {
      setViewingPastDate(d);
    }
  };

  const findPrevEntry = (exerciseName) => {
    const dates = Object.keys(logs)
      .filter((d) => d < activeDate)
      .sort((a, b) => (a < b ? 1 : -1));
    for (const d of dates) {
      const found = logs[d].find((e) => e.exerciseName === exerciseName);
      if (found) return found;
    }
    return null;
  };

  const updateEntries = (newEntries) => {
    persistLogs({ ...logs, [activeDate]: newEntries });
  };

  const handlePickExercise = (bodyPart, exerciseName) => {
    const newEntry =
      bodyPart === "cardio"
        ? { exerciseName, bodyPart, note: "", sets: [{ speed: "", incline: "", duration: "" }] }
        : { exerciseName, bodyPart, note: "", sets: [{ weight: "", reps: "", bw: false }] };
    updateEntries([...(entriesForDate || []), newEntry]);
    setPickerOpen(false);
  };

  const handleSaveExercises = (next) => {
    setExercises(next);
    saveExercises(next);
  };
  const handleSaveBodyWeight = (kg) => {
    setBodyWeightKg(kg);
    saveBodyWeight(kg);
  };
  const handleSaveGoalsMemo = (text) => {
    setGoalsMemo(text);
    saveGoalsMemo(text);
  };

  const handleUpdateEntry = (idx, updated) => {
    const next = entriesForDate.slice();
    next[idx] = updated;
    updateEntries(next);
  };

  const handleDeleteEntry = (idx) => {
    const next = entriesForDate.filter((_, i) => i !== idx);
    if (next.length === 0) {
      const rest = { ...logs };
      delete rest[activeDate];
      persistLogs(rest);
    } else {
      updateEntries(next);
    }
  };

  if (loading) {
    return (
      <div style={{ background: COLORS.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <style>{FONT_IMPORT}</style>
        <div style={{ color: COLORS.textMute, fontFamily: "Inter, sans-serif", fontSize: 13 }}>読み込み中...</div>
      </div>
    );
  }

  return (
    <div style={{ background: COLORS.bg, minHeight: "100vh", color: COLORS.text, fontFamily: "Inter, sans-serif", display: "flex", flexDirection: "column" }}>
      <style>{FONT_IMPORT}</style>

      {/* Header */}
      <div style={{ padding: "18px 18px 14px", borderBottom: `1px solid ${COLORS.borderSoft}`, position: "sticky", top: 0, background: COLORS.bg, zIndex: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <IconPlate size={20} />
            <span style={{ fontFamily: "Bebas Neue, Inter, sans-serif", fontSize: 22, letterSpacing: 1.5, color: COLORS.text }}>WORKOUT</span>
          </div>
          <button onClick={() => setSettingsOpen(true)} style={iconBtnStyle} aria-label="設定">
            <IconGear />
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, padding: "16px 16px 100px", overflowY: "auto" }}>
        {tab === "log" && (
          <>
            <GoalsMemo value={goalsMemo} onSave={handleSaveGoalsMemo} />

            <MonthCalendar monthCursor={monthCursor} setMonthCursor={setMonthCursor} logs={logs} selectedDate={activeDate} onSelectDate={handleSelectDate} />

            <ArchiveRow logs={logs} monthCursor={monthCursor} />

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", margin: "18px 2px 10px" }}>
              <div>
                {viewingPastDate && (
                  <button onClick={() => setViewingPastDate(null)} style={{ ...iconBtnStyle, marginLeft: -6, display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <IconBack size={16} />
                    <span style={{ color: COLORS.textSoft, fontSize: 12 }}>今日に戻る</span>
                  </button>
                )}
                <div style={{ fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 16, color: COLORS.text }}>{formatDateLabel(activeDate)}</div>
                <div style={{ fontSize: 11, color: COLORS.textMute, marginTop: 2 }}>{daysAgoLabel(activeDate)}</div>
              </div>
              {entriesForDate.length > 0 && <DayStatsRow entries={entriesForDate} />}
            </div>

            {entriesForDate.length === 0 ? (
              <EmptyState title="この日の記録はまだありません" body="下の「＋ 種目を追加」からトレーニングを記録しましょう。" />
            ) : (
              entriesForDate.map((entry, idx) =>
                entry.bodyPart === "cardio" ? (
                  <CardioCard key={idx} entry={entry} prevEntry={findPrevEntry(entry.exerciseName)} bodyWeightKg={bodyWeightKg} onUpdate={(u) => handleUpdateEntry(idx, u)} onDelete={() => handleDeleteEntry(idx)} />
                ) : (
                  <ExerciseCard key={idx} entry={entry} prevEntry={findPrevEntry(entry.exerciseName)} onUpdate={(u) => handleUpdateEntry(idx, u)} onDelete={() => handleDeleteEntry(idx)} />
                )
              )
            )}
            <button
              onClick={() => setPickerOpen(true)}
              style={{ width: "100%", background: COLORS.accent, border: "none", borderRadius: 12, padding: "14px", color: "#161310", fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 15, cursor: "pointer", marginTop: 6 }}
            >
              ＋ 種目を追加
            </button>
          </>
        )}

        {tab === "history" && (
          <HistoryView
            logs={logs}
            onSelectDate={(d) => {
              setViewingPastDate(d);
              setMonthCursor(ymOf(d));
              setTab("log");
            }}
          />
        )}
      </div>

      {/* Bottom nav */}
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: COLORS.surface, borderTop: `1px solid ${COLORS.border}`, display: "flex", padding: "10px 8px calc(10px + env(safe-area-inset-bottom, 0px))", maxWidth: 640, margin: "0 auto" }}>
        {[
          { id: "log", label: "記録" },
          { id: "history", label: "履歴" },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setTab(t.id);
              if (t.id !== "log") setViewingPastDate(null);
            }}
            style={{ flex: 1, background: "transparent", border: "none", padding: "8px 0", cursor: "pointer", color: tab === t.id ? COLORS.accent : COLORS.textMute, fontFamily: "Inter, sans-serif", fontWeight: tab === t.id ? 700 : 500, fontSize: 13, borderTop: `2px solid ${tab === t.id ? COLORS.accent : "transparent"}`, marginTop: -10, paddingTop: 10 }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {pickerOpen && (
        <ExercisePicker
          allExercises={exercises}
          onPick={handlePickExercise}
          onClose={() => setPickerOpen(false)}
          onOpenSettings={() => {
            setPickerOpen(false);
            setSettingsOpen(true);
          }}
        />
      )}

      {settingsOpen && (
        <SettingsModal
          exercises={exercises}
          onSave={handleSaveExercises}
          bodyWeightKg={bodyWeightKg}
          onSaveBodyWeight={handleSaveBodyWeight}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
