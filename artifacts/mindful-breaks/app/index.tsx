import React, { useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';

type Phase =
  | 'loading'
  | 'name'
  | 'bedtime'
  | 'interval'
  | 'morning'
  | 'active'
  | 'prompt'
  | 'breathing'
  | 'reflection'
  | 'dayEnd'
  | 'sleeping'
  | 'goodNight';

type Reflection = {
  date: string;
  average: number;
  ratings: number[];
  yesterdayResponse?: string;
  todayResponse?: string;
};

type Settings = {
  name: string;
  bedtime: string;
  wakeTime: string;
  intervalMinutes: number;
};

type SavedDay = {
  date: string;
  ratings: number[];
  phase: Phase;
  nextBreakAt: number | null;
  promptAt: number | null;
  bedtimeAt?: number | null;
  wakeAt?: number | null;
};

const SETTINGS_KEY = 'mindful-breaks:settings';
const HISTORY_KEY = 'mindful-breaks:history';
const DAY_KEY = 'mindful-breaks:day';
const INTERVALS = [5, 10, 15, 30, 60, 90, 120];
const BREATH_COUNTS = [4, 8, 12, 8, 4];
const MOODS = [
  { value: 1, label: 'Very hard', icon: 'frown' as const },
  { value: 2, label: 'A little heavy', icon: 'meh' as const },
  { value: 3, label: 'Okay', icon: 'minus-circle' as const },
  { value: 4, label: 'Good', icon: 'smile' as const },
  { value: 5, label: 'Really good', icon: 'sun' as const },
];

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function parseTime(value: string, fallback: string) {
  const clean = value.trim().toUpperCase().replace(/\s+/g, ' ');
  const match = clean.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/);
  if (!match) return parseTime(fallback, '10:00 PM');
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  if (minute > 59) return parseTime(fallback, '10:00 PM');
  const meridiem = match[3];
  if (meridiem === 'PM' && hour < 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;
  if (!meridiem && hour <= 6) hour += 12;
  if (hour > 23) return parseTime(fallback, '10:00 PM');
  return hour * 60 + minute;
}

function timeToday(value: string) {
  const minutes = parseTime(value, '10:00 PM');
  const date = new Date();
  date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return date.getTime();
}

function nextClockTime(value: string, after = Date.now()) {
  const today = timeToday(value);
  return today > after ? today : today + 24 * 60 * 60 * 1000;
}

function wakeTimeForGoodNight(settings: Settings, now: number) {
  const wakeToday = timeToday(settings.wakeTime);
  const bedtimeToday = timeToday(settings.bedtime);
  if (now >= wakeToday && now < bedtimeToday) return now;
  return nextClockTime(settings.wakeTime, now);
}

function displayTime(value: string) {
  const minutes = parseTime(value, '10:00 PM');
  const hour24 = Math.floor(minutes / 60);
  const hour = hour24 % 12 || 12;
  return `${hour}:${String(minutes % 60).padStart(2, '0')} ${hour24 >= 12 ? 'PM' : 'AM'}`;
}

function formatDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatInterval(minutes: number) {
  if (minutes === 60) return '1 hour';
  if (minutes === 90) return '1.5 hours';
  if (minutes === 120) return '2 hours';
  return `${minutes} minutes`;
}

function friendlyDate(date: string) {
  const parsed = new Date(`${date}T12:00:00`);
  return parsed.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
}

function averageFor(ratings: number[]) {
  if (!ratings.length) return 3;
  return ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length;
}

function getConclusion(average: number) {
  if (average < 2) return 'Today felt especially heavy. You still made space to notice it, and that matters.';
  if (average < 3) return 'Today had some difficult edges. A little care can make tomorrow feel more workable.';
  if (average < 4) return 'You found some steadiness today. Keep noticing the small moments that help.';
  if (average < 5) return 'There was a lot of good in today. Let yourself keep some of that feeling overnight.';
  return 'You had a bright day. That kind of joy is worth remembering and making room for again.';
}

function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  icon?: keyof typeof Feather.glyphMap;
  disabled?: boolean;
}) {
  const colors = useColors();
  return (
    <Pressable
      testID={`button-${label}`}
      accessibilityRole="button"
      disabled={disabled}
      onPress={() => {
        Haptics.selectionAsync();
        onPress();
      }}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' && { backgroundColor: colors.primary },
        variant === 'secondary' && { backgroundColor: colors.secondary },
        variant === 'ghost' && { backgroundColor: 'transparent' },
        disabled && { opacity: 0.45 },
        pressed && { transform: [{ scale: 0.98 }], opacity: 0.85 },
      ]}
    >
      {icon ? (
        <Feather
          name={icon}
          size={17}
          color={variant === 'primary' ? colors.primaryForeground : colors.secondaryForeground}
        />
      ) : null}
      <Text
        style={[
          styles.buttonText,
          {
            color: variant === 'primary' ? colors.primaryForeground : colors.secondaryForeground,
          },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function ProgressDots({ step, total = 3 }: { step: number; total?: number }) {
  const colors = useColors();
  return (
    <View style={styles.dots}>
      {Array.from({ length: total }).map((_, index) => (
        <View
          key={index}
          style={[
            styles.dot,
            { backgroundColor: index <= step ? colors.primary : colors.border },
          ]}
        />
      ))}
    </View>
  );
}

function Page({
  children,
  scroll = true,
  top = 24,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  top?: number;
}) {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const content = (
    <View
      style={[
        styles.pageContent,
        { paddingTop: insets.top + top, paddingBottom: insets.bottom + 28 },
      ]}
    >
      {children}
    </View>
  );
  return scroll ? (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ flexGrow: 1 }}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {content}
    </ScrollView>
  ) : (
    <View style={[styles.page, { backgroundColor: colors.background }]}>{content}</View>
  );
}

function LogoMark() {
  const colors = useColors();
  return (
    <View style={[styles.logoMark, { backgroundColor: colors.navy, borderColor: colors.border }]}>
      <Image
        source={require('../assets/images/zenergy-logo.png')}
        resizeMode="contain"
        style={styles.logoImage}
        accessibilityLabel="Zenergy lotus logo"
      />
    </View>
  );
}

function SetupHeader({ step, eyebrow }: { step: number; eyebrow: string }) {
  const colors = useColors();
  return (
    <>
      <View style={styles.brandRow}>
        <LogoMark />
        <Text style={[styles.brandName, { color: colors.foreground }]}>zenergy</Text>
      </View>
      <ProgressDots step={step} />
      <Text style={[styles.eyebrow, { color: colors.primary }]}>{eyebrow}</Text>
    </>
  );
}

function IntervalPicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  const colors = useColors();
  return (
    <View style={styles.choiceGrid}>
      {INTERVALS.map((interval) => {
        const selected = value === interval;
        return (
          <Pressable
            key={interval}
            testID={`interval-${interval}`}
            onPress={() => {
              Haptics.selectionAsync();
              onChange(interval);
            }}
            style={({ pressed }) => [
              styles.choice,
              {
                backgroundColor: selected ? colors.primary : colors.card,
                borderColor: selected ? colors.primary : colors.border,
              },
              pressed && { opacity: 0.8 },
            ]}
          >
            <Text style={[styles.choiceText, { color: selected ? colors.primaryForeground : colors.foreground }]}>
              {formatInterval(interval)}
            </Text>
            {selected ? <Feather name="check" size={16} color={colors.primaryForeground} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function SettingsModal({
  visible,
  settings,
  onClose,
  onSave,
}: {
  visible: boolean;
  settings: Settings;
  onClose: () => void;
  onSave: (settings: Settings) => void;
}) {
  const colors = useColors();
  const [draft, setDraft] = useState(settings);
  useEffect(() => {
    if (visible) setDraft(settings);
  }, [visible, settings]);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={[styles.modalBackdrop, { backgroundColor: 'rgba(23, 33, 43, 0.4)' }]}>
        <View style={[styles.sheet, { backgroundColor: colors.card }]}>
          <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />
          <View style={styles.sheetHeader}>
            <View>
              <Text style={[styles.sheetTitle, { color: colors.foreground }]}>Schedule</Text>
              <Text style={[styles.sheetSubtitle, { color: colors.mutedForeground }]}>
                Changes reset the current timer.
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={12}>
              <Feather name="x" size={22} color={colors.mutedForeground} />
            </Pressable>
          </View>
          <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Bedtime</Text>
          <TextInput
            value={draft.bedtime}
            onChangeText={(value) => setDraft({ ...draft, bedtime: value })}
            placeholder="10:00 PM"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
          />
          <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Wake time</Text>
          <TextInput
            value={draft.wakeTime}
            onChangeText={(value) => setDraft({ ...draft, wakeTime: value })}
            placeholder="7:00 AM"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
          />
          <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Break every</Text>
          <IntervalPicker value={draft.intervalMinutes} onChange={(value) => setDraft({ ...draft, intervalMinutes: value })} />
          <Button
            label="Save schedule"
            icon="check"
            onPress={() => onSave({ ...draft, bedtime: displayTime(draft.bedtime), wakeTime: displayTime(draft.wakeTime) })}
          />
        </View>
      </View>
    </Modal>
  );
}

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>('loading');
  const [settings, setSettings] = useState<Settings>({
    name: '',
    bedtime: '10:00 PM',
    wakeTime: '7:00 AM',
    intervalMinutes: 30,
  });
  const [draftName, setDraftName] = useState('');
  const [draftBedtime, setDraftBedtime] = useState('10:00 PM');
  const [intervalMinutes, setIntervalMinutes] = useState(30);
  const [dailyRatings, setDailyRatings] = useState<number[]>([]);
  const [history, setHistory] = useState<Reflection[]>([]);
  const [nextBreakAt, setNextBreakAt] = useState<number | null>(null);
  const [promptAt, setPromptAt] = useState<number | null>(null);
  const [bedtimeAt, setBedtimeAt] = useState<number | null>(null);
  const [wakeAt, setWakeAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [selectedMood, setSelectedMood] = useState<number | null>(null);
  const [todayResponse, setTodayResponse] = useState('');
  const [yesterdayResponse, setYesterdayResponse] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [breathIndex, setBreathIndex] = useState(0);
  const [breathDirection, setBreathDirection] = useState<'in' | 'out'>('in');
  const breathScale = useRef(new Animated.Value(0.55)).current;

  const yesterday = history.length ? history[history.length - 1] : undefined;
  const currentAverage = averageFor(dailyRatings);
  const timeRemaining = nextBreakAt ? Math.max(0, nextBreakAt - now) : 0;
  const bedtimePassed = bedtimeAt !== null && now >= bedtimeAt;

  useEffect(() => {
    let mounted = true;
    async function hydrate() {
      try {
        const [savedSettings, savedHistory, savedDay] = await Promise.all([
          AsyncStorage.getItem(SETTINGS_KEY),
          AsyncStorage.getItem(HISTORY_KEY),
          AsyncStorage.getItem(DAY_KEY),
        ]);
        if (!mounted) return;
        const parsedSettings = savedSettings ? (JSON.parse(savedSettings) as Settings) : null;
        const parsedHistory = savedHistory ? (JSON.parse(savedHistory) as Reflection[]) : [];
        const parsedDay = savedDay ? (JSON.parse(savedDay) as SavedDay) : null;
        if (parsedSettings) {
          setSettings(parsedSettings);
          setDraftName(parsedSettings.name);
          setDraftBedtime(parsedSettings.bedtime);
          setIntervalMinutes(parsedSettings.intervalMinutes);
        }
        setHistory(parsedHistory);
        if (!parsedSettings) {
          setPhase('name');
        } else if (!parsedDay) {
          setPhase('morning');
          setDailyRatings([]);
        } else if (parsedDay.phase === 'sleeping' || parsedDay.phase === 'goodNight') {
          const savedWakeAt =
            parsedDay.wakeAt ?? wakeTimeForGoodNight(parsedSettings, Date.now());
          setDailyRatings(parsedDay.ratings);
          if (savedWakeAt <= Date.now()) {
            setWakeAt(null);
            setPhase('morning');
          } else {
            setWakeAt(savedWakeAt);
            setPhase('sleeping');
          }
        } else if (
          parsedDay.phase === 'dayEnd' ||
          (parsedDay.bedtimeAt !== undefined &&
            parsedDay.bedtimeAt !== null &&
            parsedDay.bedtimeAt <= Date.now()) ||
          (!parsedDay.bedtimeAt &&
            parsedDay.date === todayKey() &&
            Date.now() >= timeToday(parsedSettings.bedtime))
        ) {
          setPhase('dayEnd');
          setDailyRatings(parsedDay.ratings);
          setBedtimeAt(parsedDay.bedtimeAt ?? timeToday(parsedSettings.bedtime));
        } else if (
          parsedDay.date !== todayKey() && !parsedDay.bedtimeAt
        ) {
          setPhase('morning');
          setDailyRatings([]);
        } else {
          setPhase(parsedDay.phase === 'breathing' || parsedDay.phase === 'reflection' ? 'active' : parsedDay.phase);
          setDailyRatings(parsedDay.ratings);
          setNextBreakAt(parsedDay.nextBreakAt);
          setPromptAt(parsedDay.promptAt);
          setBedtimeAt(parsedDay.bedtimeAt ?? nextClockTime(parsedSettings.bedtime));
          setWakeAt(null);
        }
      } catch {
        setPhase('name');
      } finally {
        setHydrated(true);
      }
    }
    hydrate();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!hydrated || phase === 'loading' || phase === 'name' || phase === 'bedtime') return;
    const savedDay: SavedDay = {
      date: todayKey(),
      ratings: dailyRatings,
      phase,
      nextBreakAt,
      promptAt,
      bedtimeAt,
      wakeAt,
    };
    AsyncStorage.setItem(DAY_KEY, JSON.stringify(savedDay));
  }, [bedtimeAt, dailyRatings, hydrated, nextBreakAt, phase, promptAt, wakeAt]);

  useEffect(() => {
    if (phase !== 'sleeping' || !wakeAt || now < wakeAt) return;
    setWakeAt(null);
    setBedtimeAt(null);
    setNextBreakAt(null);
    setPromptAt(null);
    setDailyRatings([]);
    setPhase('morning');
  }, [now, phase, wakeAt]);

  useEffect(() => {
    if (phase === 'active' && nextBreakAt && now >= nextBreakAt) {
      if (bedtimePassed) {
        setPhase('dayEnd');
        setNextBreakAt(null);
      } else {
        setPromptAt(now);
        setPhase('prompt');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    }
    if (phase === 'active' && bedtimePassed) {
      setPhase('dayEnd');
      setNextBreakAt(null);
    }
    if (phase === 'prompt' && promptAt && now - promptAt >= 120000) {
      scheduleNextBreak();
    }
  }, [bedtimePassed, nextBreakAt, now, phase, promptAt]);

  useEffect(() => {
    if (phase !== 'breathing') return;
    const count = BREATH_COUNTS[breathIndex];
    const target = breathDirection === 'in' ? 1 : 0.55;
    Animated.timing(breathScale, {
      toValue: target,
      duration: count * 1000,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: true,
    }).start();
    const segment = setTimeout(() => {
      if (breathDirection === 'in') {
        setBreathDirection('out');
      } else if (breathIndex < BREATH_COUNTS.length - 1) {
        setBreathIndex((index) => index + 1);
        setBreathDirection('in');
      } else {
        setPhase('reflection');
        setSelectedMood(null);
        breathScale.setValue(0.55);
      }
    }, count * 1000);
    return () => clearTimeout(segment);
  }, [breathDirection, breathIndex, breathScale, phase]);

  function saveSettings(next: Settings) {
    setSettings(next);
    setDraftName(next.name);
    setDraftBedtime(next.bedtime);
    setIntervalMinutes(next.intervalMinutes);
    setSettingsOpen(false);
    AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    if (phase === 'sleeping' || phase === 'goodNight') {
      setBedtimeAt(null);
      setWakeAt(nextClockTime(next.wakeTime));
      setNextBreakAt(null);
      setPromptAt(null);
      setPhase('sleeping');
      return;
    }
    setPhase('active');
    setBedtimeAt(nextClockTime(next.bedtime));
    setWakeAt(null);
    setNextBreakAt(Date.now() + next.intervalMinutes * 60000);
    setPromptAt(null);
  }

  function scheduleNextBreak() {
    setPromptAt(null);
    setBedtimeAt(nextClockTime(settings.bedtime));
    setWakeAt(null);
    setNextBreakAt(Date.now() + settings.intervalMinutes * 60000);
    setPhase('active');
  }

  function completeSetup() {
    const next: Settings = {
      name: draftName.trim() || 'Friend',
      bedtime: displayTime(draftBedtime),
      wakeTime: '7:00 AM',
      intervalMinutes,
    };
    setSettings(next);
    AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    setBedtimeAt(nextClockTime(next.bedtime));
    setWakeAt(null);
    setNextBreakAt(Date.now() + intervalMinutes * 60000);
    setPhase('active');
  }

  function beginMorning() {
    setDailyRatings([]);
    setSelectedMood(null);
    setBedtimeAt(nextClockTime(settings.bedtime));
    setWakeAt(null);
    setPhase('active');
    setNextBreakAt(Date.now() + settings.intervalMinutes * 60000);
  }

  function startBreathing() {
    setBreathIndex(0);
    setBreathDirection('in');
    breathScale.setValue(0.55);
    setPhase('breathing');
  }

  function finishReflection() {
    if (!selectedMood) return;
    const nextRatings = [...dailyRatings, selectedMood];
    setDailyRatings(nextRatings);
    setSelectedMood(null);
    if (bedtimeAt !== null && Date.now() >= bedtimeAt) {
      setPhase('dayEnd');
      setNextBreakAt(null);
    } else {
      setNextBreakAt(Date.now() + settings.intervalMinutes * 60000);
      setPhase('active');
    }
  }

  function finishDay() {
    const reflection: Reflection = {
      date: todayKey(),
      average: currentAverage,
      ratings: dailyRatings,
      todayResponse: todayResponse.trim(),
      yesterdayResponse: yesterdayResponse.trim(),
    };
    const nextHistory = [...history, reflection].slice(-14);
    setHistory(nextHistory);
    AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(nextHistory));
    setBedtimeAt(null);
    setNextBreakAt(null);
    setPromptAt(null);
    setWakeAt(nextClockTime(settings.wakeTime));
    setPhase('sleeping');
    setTodayResponse('');
    setYesterdayResponse('');
  }

  if (!hydrated || phase === 'loading') {
    return (
      <View style={[styles.loading, { backgroundColor: colors.background }]}>
        <LogoMark />
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (phase === 'name') {
    return (
      <Page>
        <SetupHeader step={0} eyebrow="A softer way to pause" />
        <View style={styles.setupHero}>
          <Text style={[styles.heroTitle, { color: colors.foreground }]}>Make room for how you feel.</Text>
          <Text style={[styles.heroBody, { color: colors.mutedForeground }]}>
            Zenergy gently interrupts your day with a short breathing practice and a moment to check in.
          </Text>
        </View>
        <View style={styles.formBlock}>
          <Text style={[styles.fieldLabel, { color: colors.foreground }]}>What should we call you?</Text>
          <TextInput
            autoFocus
            value={draftName}
            onChangeText={setDraftName}
            placeholder="Your first name"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
            returnKeyType="done"
          />
          <Button label="Continue" icon="arrow-right" onPress={() => setPhase('bedtime')} disabled={!draftName.trim()} />
        </View>
        <Text style={[styles.privacyNote, { color: colors.mutedForeground }]}>
          Your reflections stay on this device.
        </Text>
      </Page>
    );
  }

  if (phase === 'bedtime') {
    return (
      <Page>
        <SetupHeader step={1} eyebrow="Your evening boundary" />
        <View style={styles.setupHero}>
          <Text style={[styles.heroTitle, { color: colors.foreground }]}>When does your day wind down?</Text>
          <Text style={[styles.heroBody, { color: colors.mutedForeground }]}>
            We’ll keep breaks inside your waking hours and let the timer end naturally at bedtime.
          </Text>
        </View>
        <View style={styles.formBlock}>
          <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Bedtime</Text>
          <TextInput
            value={draftBedtime}
            onChangeText={setDraftBedtime}
            placeholder="10:00 PM"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
            autoFocus
          />
          <Text style={[styles.helper, { color: colors.mutedForeground }]}>Try “10:30 PM” or “11 PM”.</Text>
          <Button label="Next" icon="arrow-right" onPress={() => setPhase('interval')} />
        </View>
      </Page>
    );
  }

  if (phase === 'interval') {
    return (
      <Page>
        <SetupHeader step={2} eyebrow="One last thing" />
        <View style={styles.setupHero}>
          <Text style={[styles.heroTitle, { color: colors.foreground }]}>How often would you like to pause?</Text>
          <Text style={[styles.heroBody, { color: colors.mutedForeground }]}>
            We’ll ask you each morning so your rhythm can change with your day.
          </Text>
        </View>
        <IntervalPicker value={intervalMinutes} onChange={setIntervalMinutes} />
        <Button label="Set up my day" icon="check" onPress={completeSetup} />
      </Page>
    );
  }

  if (phase === 'morning') {
    return (
      <Page>
        <View style={styles.topRow}>
          <View>
            <Text style={[styles.eyebrow, { color: colors.primary }]}>Good morning</Text>
            <Text style={[styles.screenTitle, { color: colors.foreground }]}>{settings.name}</Text>
          </View>
          <Pressable onPress={() => setSettingsOpen(true)} style={[styles.iconButton, { backgroundColor: colors.card }]}>
            <Feather name="sliders" size={19} color={colors.foreground} />
          </Pressable>
        </View>
        <View style={[styles.morningCard, { backgroundColor: colors.navy }]}>
          <Feather name="sunrise" color={colors.yellow} size={25} />
          <Text style={[styles.morningTitle, { color: colors.cream }]}>How should today feel?</Text>
          <Text style={[styles.morningBody, { color: colors.sage }]}>
            Choose a break rhythm that gives you enough space to come back to yourself.
          </Text>
        </View>
        <Text style={[styles.sectionLabel, { color: colors.foreground }]}>Break every</Text>
        <IntervalPicker value={settings.intervalMinutes} onChange={(value) => setIntervalMinutes(value)} />
        <Button label="Begin today" icon="arrow-right" onPress={() => { saveSettings({ ...settings, intervalMinutes }); beginMorning(); }} />
        <SettingsModal visible={settingsOpen} settings={settings} onClose={() => setSettingsOpen(false)} onSave={saveSettings} />
      </Page>
    );
  }

  if (phase === 'prompt') {
    return (
      <Page scroll={false} top={0}>
        <View style={[styles.fullCenter, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
          <View style={styles.promptOrb}>
            <View style={[styles.promptOrbInner, { backgroundColor: colors.accent }]} />
            <Feather name="pause" size={30} color={colors.accentForeground} />
          </View>
          <Text style={[styles.eyebrow, { color: colors.primary }]}>A pause is here</Text>
          <Text style={[styles.promptTitle, { color: colors.foreground }]}>Time for a break, {settings.name}?</Text>
          <Text style={[styles.heroBody, { color: colors.mutedForeground, textAlign: 'center' }]}>
            Take two quiet minutes to reset your body and your attention.
          </Text>
          <View style={styles.promptActions}>
            <Button label="Take the break" icon="wind" onPress={startBreathing} />
            <Button label="Skip this one" variant="secondary" icon="arrow-right" onPress={scheduleNextBreak} />
          </View>
          <Text style={[styles.helper, { color: colors.mutedForeground }]}>
            If you don’t choose, we’ll reset the timer in {formatDuration(Math.max(0, (promptAt ?? now) + 120000 - now))}.
          </Text>
        </View>
      </Page>
    );
  }

  if (phase === 'breathing') {
    const count = BREATH_COUNTS[breathIndex];
    return (
      <Page scroll={false} top={0}>
        <View style={[styles.fullCenter, { paddingTop: insets.top + 22, paddingBottom: insets.bottom + 22 }]}>
          <View style={styles.breathTop}>
            <Text style={[styles.eyebrow, { color: colors.primary }]}>Guided breathing</Text>
            <Text style={[styles.breathProgress, { color: colors.mutedForeground }]}>
              {Math.floor(breathIndex / 2) + 1} of {BREATH_COUNTS.length / 2}
            </Text>
          </View>
          <Animated.View
            style={[
              styles.breathCircleOuter,
              { backgroundColor: colors.secondary, transform: [{ scale: breathScale }] },
            ]}
          >
            <View style={[styles.breathCircleInner, { backgroundColor: colors.sage }]}>
              <Text style={[styles.breathCount, { color: colors.navy }]}>{count}</Text>
              <Text style={[styles.breathDirection, { color: colors.navy }]}>
                {breathDirection === 'in' ? 'breathe in' : 'breathe out'}
              </Text>
            </View>
          </Animated.View>
          <Text style={[styles.breathInstruction, { color: colors.foreground }]}>
            Follow the circle
          </Text>
          <Text style={[styles.heroBody, { color: colors.mutedForeground, textAlign: 'center' }]}>
            Let your shoulders soften. There is nowhere else to be for this moment.
          </Text>
        </View>
      </Page>
    );
  }

  if (phase === 'reflection') {
    return (
      <Page>
        <View style={styles.topRow}>
          <View>
            <Text style={[styles.eyebrow, { color: colors.primary }]}>Come back to yourself</Text>
            <Text style={[styles.screenTitle, { color: colors.foreground }]}>How’s your day going?</Text>
          </View>
          <View style={[styles.miniIcon, { backgroundColor: colors.accent }]}>
            <Feather name="heart" size={18} color={colors.accentForeground} />
          </View>
        </View>
        <Text style={[styles.heroBody, { color: colors.mutedForeground }]}>
          There’s no right answer. Choose what feels closest right now.
        </Text>
        <View style={styles.moodList}>
          {MOODS.map((mood) => {
            const selected = selectedMood === mood.value;
            return (
              <Pressable
                key={mood.value}
                testID={`mood-${mood.value}`}
                onPress={() => {
                  Haptics.selectionAsync();
                  setSelectedMood(mood.value);
                }}
                style={({ pressed }) => [
                  styles.moodRow,
                  {
                    backgroundColor: selected ? colors.primary : colors.card,
                    borderColor: selected ? colors.primary : colors.border,
                  },
                  pressed && { transform: [{ scale: 0.99 }], opacity: 0.9 },
                ]}
              >
                <Feather name={mood.icon} size={22} color={selected ? colors.primaryForeground : colors.primary} />
                <Text style={[styles.moodText, { color: selected ? colors.primaryForeground : colors.foreground }]}>
                  {mood.label}
                </Text>
                {selected ? <Feather name="check" size={18} color={colors.primaryForeground} /> : null}
              </Pressable>
            );
          })}
        </View>
        <Button label="Save reflection" icon="arrow-right" onPress={finishReflection} disabled={!selectedMood} />
      </Page>
    );
  }

  if (phase === 'sleeping' || phase === 'goodNight') {
    return (
      <Page>
        <View style={styles.topRow}>
          <View>
            <Text style={[styles.eyebrow, { color: colors.primary }]}>Day complete</Text>
            <Text style={[styles.screenTitle, { color: colors.foreground }]}>
              Good night, {settings.name}.
            </Text>
          </View>
          <Pressable onPress={() => setSettingsOpen(true)} style={[styles.iconButton, { backgroundColor: colors.card }]}>
            <Feather name="sliders" size={19} color={colors.foreground} />
          </Pressable>
        </View>
        <View style={[styles.goodNightCard, { backgroundColor: colors.accent }]}>
          <Feather name="moon" size={28} color={colors.accentForeground} />
          <Text style={[styles.goodNightTitle, { color: colors.accentForeground }]}>
            You did enough for today.
          </Text>
          <Text style={[styles.heroBody, { color: colors.accentForeground }]}>
            Rest well. Your next day begins at {displayTime(settings.wakeTime)}.
          </Text>
        </View>
        <View style={[styles.streakCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.streakIcon, { backgroundColor: colors.secondary }]}>
            <Feather name="clock" size={18} color={colors.secondaryForeground} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.streakTitle, { color: colors.foreground }]}>Time to wake</Text>
            <Text style={[styles.helper, { color: colors.mutedForeground }]}>
              {wakeAt ? formatDuration(wakeAt - now) : `At ${displayTime(settings.wakeTime)}`}
            </Text>
          </View>
        </View>
        <Button
          label="Start my morning now"
          icon="sunrise"
          variant="secondary"
          onPress={() => {
            setWakeAt(null);
            setBedtimeAt(null);
            setNextBreakAt(null);
            setPhase('morning');
          }}
        />
        <SettingsModal visible={settingsOpen} settings={settings} onClose={() => setSettingsOpen(false)} onSave={saveSettings} />
      </Page>
    );
  }

  if (phase === 'dayEnd') {
    const yesterdayWasGood = (yesterday?.average ?? 3) >= 3;
    const todayWasGood = currentAverage >= 3;
    return (
      <Page>
        <View style={styles.topRow}>
          <View>
            <Text style={[styles.eyebrow, { color: colors.primary }]}>A gentle close</Text>
            <Text style={[styles.screenTitle, { color: colors.foreground }]}>Before you rest</Text>
          </View>
          <Pressable onPress={() => setSettingsOpen(true)} style={[styles.iconButton, { backgroundColor: colors.card }]}>
            <Feather name="sliders" size={19} color={colors.foreground} />
          </Pressable>
        </View>
        <View style={[styles.summaryCard, { backgroundColor: colors.navy }]}>
          <Text style={[styles.summaryKicker, { color: colors.sage }]}>TODAY’S AVERAGE</Text>
          <Text style={[styles.summaryScore, { color: colors.cream }]}>{currentAverage.toFixed(1)}</Text>
          <Text style={[styles.summaryMessage, { color: colors.cream }]}>{getConclusion(currentAverage)}</Text>
        </View>
        {yesterday ? (
          <View style={[styles.yesterdayCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.sectionLabel, { color: colors.foreground }]}>Yesterday · {friendlyDate(yesterday.date)}</Text>
            <Text style={[styles.yesterdayScore, { color: colors.primary }]}>{yesterday.average.toFixed(1)} / 5</Text>
            <Text style={[styles.helper, { color: colors.mutedForeground }]}>
              {yesterday.todayResponse || 'You made space to check in with yourself.'}
            </Text>
          </View>
        ) : null}
        <Text style={[styles.sectionLabel, { color: colors.foreground }]}>
          {yesterdayWasGood
            ? 'Did any of yesterday’s good things carry into today? What changed?'
            : 'Was today any better than yesterday? Why or why not?'}
        </Text>
        <TextInput
          value={yesterdayResponse}
          onChangeText={setYesterdayResponse}
          multiline
          placeholder={yesterdayWasGood ? 'A moment I carried with me…' : 'Today felt different because…'}
          placeholderTextColor={colors.mutedForeground}
          style={[styles.textArea, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
        />
        <Text style={[styles.sectionLabel, { color: colors.foreground }]}>
          {todayWasGood ? 'What was really good about today?' : 'What could be better tomorrow?'}
        </Text>
        <TextInput
          value={todayResponse}
          onChangeText={setTodayResponse}
          multiline
          placeholder={todayWasGood ? 'I want to remember…' : 'Tomorrow, I’d like to…'}
          placeholderTextColor={colors.mutedForeground}
          style={[styles.textArea, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
        />
        <Button label="Finish my day" icon="moon" onPress={finishDay} />
        <SettingsModal visible={settingsOpen} settings={settings} onClose={() => setSettingsOpen(false)} onSave={saveSettings} />
      </Page>
    );
  }

  return (
    <Page>
      <View style={styles.topRow}>
        <View>
          <Text style={[styles.eyebrow, { color: colors.primary }]}>Your next pause</Text>
          <Text style={[styles.screenTitle, { color: colors.foreground }]}>Hello, {settings.name}.</Text>
        </View>
        <Pressable onPress={() => setSettingsOpen(true)} style={[styles.iconButton, { backgroundColor: colors.card }]}>
          <Feather name="sliders" size={19} color={colors.foreground} />
        </Pressable>
      </View>
      <View style={[styles.timerCard, { backgroundColor: colors.navy }]}>
        <View style={[styles.timerIcon, { backgroundColor: colors.secondary }]}>
          <Feather name="wind" size={20} color={colors.yellow} />
        </View>
        <Text style={[styles.timerLabel, { color: colors.sage }]}>NEXT BREAK IN</Text>
        <Text style={[styles.timerValue, { color: colors.cream }]}>{formatDuration(timeRemaining)}</Text>
        <Text style={[styles.timerNote, { color: colors.sage }]}>
          Breaks every {formatInterval(settings.intervalMinutes)} · bedtime {displayTime(settings.bedtime)}
        </Text>
      </View>
      <View style={[styles.streakCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[styles.streakIcon, { backgroundColor: colors.secondary }]}>
          <Feather name="activity" size={18} color={colors.secondaryForeground} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.streakTitle, { color: colors.foreground }]}>
            {dailyRatings.length ? `${dailyRatings.length} check-in${dailyRatings.length === 1 ? '' : 's'} today` : 'Your first pause is ahead'}
          </Text>
          <Text style={[styles.helper, { color: colors.mutedForeground }]}>
            Small moments of noticing add up.
          </Text>
        </View>
      </View>
      <Text style={[styles.sectionLabel, { color: colors.foreground }]}>Your rhythm</Text>
      <View style={styles.rhythmRow}>
        <View style={[styles.rhythmPill, { backgroundColor: colors.secondary }]}>
          <Feather name="sunrise" size={16} color={colors.secondaryForeground} />
          <Text style={[styles.rhythmPillText, { color: colors.secondaryForeground }]}>{displayTime(settings.wakeTime)}</Text>
        </View>
        <Feather name="arrow-right" size={15} color={colors.mutedForeground} />
        <View style={[styles.rhythmPill, { backgroundColor: colors.accent }]}>
          <Feather name="moon" size={16} color={colors.accentForeground} />
          <Text style={[styles.rhythmPillText, { color: colors.accentForeground }]}>{displayTime(settings.bedtime)}</Text>
        </View>
      </View>
      <SettingsModal visible={settingsOpen} settings={settings} onClose={() => setSettingsOpen(false)} onSave={saveSettings} />
    </Page>
  );
}

const baseStyles = StyleSheet.create({
  page: { flex: 1 },
  pageContent: { flexGrow: 1, paddingHorizontal: 22 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 34 },
  brandName: { fontFamily: 'Inter_600SemiBold', fontSize: 17, letterSpacing: -0.3 },
  logoMark: { width: 44, height: 44, borderRadius: 14, borderWidth: 1, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  logoImage: { width: 58, height: 44 },
  dots: { flexDirection: 'row', gap: 6, marginBottom: 30 },
  dot: { width: 26, height: 4, borderRadius: 4 },
  eyebrow: { fontFamily: 'Inter_700Bold', fontSize: 12, letterSpacing: 1.4, textTransform: 'uppercase' },
  setupHero: { marginBottom: 34 },
  heroTitle: { fontFamily: 'Inter_700Bold', fontSize: 34, lineHeight: 39, letterSpacing: -1.3, maxWidth: 345 },
  heroBody: { fontFamily: 'Inter_400Regular', fontSize: 16, lineHeight: 24, marginTop: 13 },
  formBlock: { gap: 12 },
  fieldLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 14, marginBottom: 3 },
  input: { minHeight: 56, borderWidth: 1, borderRadius: 16, paddingHorizontal: 17, fontFamily: 'Inter_500Medium', fontSize: 16 },
  textArea: { minHeight: 104, borderWidth: 1, borderRadius: 16, paddingHorizontal: 17, paddingTop: 15, fontFamily: 'Inter_400Regular', fontSize: 16, lineHeight: 22, textAlignVertical: 'top', marginBottom: 20 },
  helper: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19 },
  privacyNote: { fontFamily: 'Inter_400Regular', fontSize: 13, textAlign: 'center', marginTop: 'auto', paddingTop: 26 },
  button: { minHeight: 55, borderRadius: 17, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 9, paddingHorizontal: 18, marginTop: 7 },
  buttonText: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  choiceGrid: { gap: 10, marginBottom: 20 },
  choice: { minHeight: 52, borderRadius: 15, borderWidth: 1, paddingHorizontal: 17, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  choiceText: { fontFamily: 'Inter_500Medium', fontSize: 15 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 22 },
  screenTitle: { fontFamily: 'Inter_700Bold', fontSize: 29, letterSpacing: -1, marginTop: 6 },
  iconButton: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  miniIcon: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  morningCard: { borderRadius: 24, padding: 22, marginBottom: 28, minHeight: 175, justifyContent: 'flex-end', gap: 8 },
  morningTitle: { fontFamily: 'Inter_700Bold', fontSize: 25, letterSpacing: -0.7, marginTop: 18 },
  morningBody: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21 },
  sectionLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 14, marginBottom: 11 },
  fullCenter: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 22 },
  promptOrb: { width: 112, height: 112, borderRadius: 56, alignItems: 'center', justifyContent: 'center', marginBottom: 28 },
  promptOrbInner: { ...StyleSheet.absoluteFill, borderRadius: 56, opacity: 0.8 },
  promptTitle: { fontFamily: 'Inter_700Bold', fontSize: 31, lineHeight: 36, letterSpacing: -1, textAlign: 'center', marginTop: 10 },
  promptActions: { width: '100%', gap: 7, marginTop: 29 },
  breathTop: { width: '100%', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', position: 'absolute', top: 22 },
  breathProgress: { fontFamily: 'Inter_500Medium', fontSize: 13 },
  breathCircleOuter: { width: 250, height: 250, borderRadius: 125, alignItems: 'center', justifyContent: 'center', marginBottom: 30 },
  breathCircleInner: { width: 188, height: 188, borderRadius: 94, alignItems: 'center', justifyContent: 'center' },
  breathCount: { fontFamily: 'Inter_700Bold', fontSize: 52, letterSpacing: -1 },
  breathDirection: { fontFamily: 'Inter_600SemiBold', fontSize: 15, marginTop: 4 },
  breathInstruction: { fontFamily: 'Inter_700Bold', fontSize: 24, letterSpacing: -0.6 },
  moodList: { gap: 10, marginTop: 28, marginBottom: 18 },
  moodRow: { minHeight: 58, borderRadius: 17, borderWidth: 1, paddingHorizontal: 17, flexDirection: 'row', alignItems: 'center', gap: 13 },
  moodText: { fontFamily: 'Inter_500Medium', fontSize: 15, flex: 1 },
  summaryCard: { borderRadius: 24, padding: 22, marginBottom: 25 },
  summaryKicker: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 1.3 },
  summaryScore: { fontFamily: 'Inter_700Bold', fontSize: 53, letterSpacing: -2, marginTop: 10 },
  summaryMessage: { fontFamily: 'Inter_500Medium', fontSize: 16, lineHeight: 23, marginTop: 4 },
  yesterdayCard: { borderRadius: 18, padding: 17, borderWidth: 1, marginBottom: 25 },
  yesterdayScore: { fontFamily: 'Inter_700Bold', fontSize: 24, marginBottom: 4 },
  timerCard: { borderRadius: 24, padding: 22, marginBottom: 16 },
  timerIcon: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 25 },
  timerLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 1.4 },
  timerValue: { fontFamily: 'Inter_700Bold', fontSize: 54, letterSpacing: -2.5, marginTop: 7 },
  timerNote: { fontFamily: 'Inter_400Regular', fontSize: 13, marginTop: 6 },
  streakCard: { borderWidth: 1, borderRadius: 18, padding: 15, flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 27 },
  streakIcon: { width: 39, height: 39, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  streakTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14, marginBottom: 2 },
  rhythmRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  rhythmPill: { borderRadius: 15, paddingVertical: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  rhythmPillText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  goodNightCard: { borderRadius: 24, padding: 23, marginBottom: 20, minHeight: 200, justifyContent: 'flex-end', gap: 9 },
  goodNightTitle: { fontFamily: 'Inter_700Bold', fontSize: 27, letterSpacing: -0.8, marginTop: 26 },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 22, paddingTop: 11, paddingBottom: 30 },
  sheetHandle: { width: 38, height: 4, borderRadius: 4, alignSelf: 'center', marginBottom: 21 },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 24 },
  sheetTitle: { fontFamily: 'Inter_700Bold', fontSize: 24, letterSpacing: -0.6 },
  sheetSubtitle: { fontFamily: 'Inter_400Regular', fontSize: 13, marginTop: 4 },
});

const styles = baseStyles;