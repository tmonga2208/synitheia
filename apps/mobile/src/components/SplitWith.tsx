import { useState } from 'react';
import { FlatList, Modal, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as Contacts from 'expo-contacts';
import { Check, UserPlus, X } from 'lucide-react-native';
import {
  asMinor,
  formatMoney,
  parseMoneyInput,
  splitEvenly,
  type Minor,
} from '@synitheia/shared';
import { Button, Card, Chip, Input, Text, Touchable } from './primitives.js';
import { accentFor, palette, radius, spacing } from '../theme/tokens.js';

const ACCENT = accentFor('#C08A7D');

export interface SplitPerson {
  name: string;
  contactId: string | null;
  shareMinor: number;
}

/** Null means you paid the bill yourself. */
export type Payer = { name: string; contactId: string | null } | null;

export interface SplitState {
  people: SplitPerson[];
  payer: Payer;
}

interface Props {
  /** The TOTAL BILL, in minor units. Null while the field is empty or invalid. */
  billMinor: Minor | null;
  currency: string;
  value: SplitState;
  onChange: (next: SplitState) => void;
}

/**
 * What the expense should actually record, given who paid.
 *
 * The one rule: `amountMinor` is always what YOU are out.
 *
 *   You paid      → the whole bill. The others owe you, and you are out the lot until
 *                   they pay you back.
 *   Someone else  → your share alone. You never had the ₹1,000; recording it would
 *                   quadruple your Friday spending on a meal a friend bought.
 */
export function resolveExpense(
  bill: Minor | null,
  state: SplitState,
): { amountMinor: number | null; billAmountMinor: number | null } {
  if (bill === null) return { amountMinor: null, billAmountMinor: null };

  if (state.people.length === 0) {
    return { amountMinor: bill, billAmountMinor: null };
  }

  const owed = state.people.reduce((acc, p) => acc + p.shareMinor, 0);
  const myShare = Math.max(0, bill - owed);

  return state.payer === null
    ? { amountMinor: bill, billAmountMinor: null }
    : { amountMinor: myShare, billAmountMinor: bill };
}

/**
 * "Who else was in on this?"
 *
 * Optional, and collapsed to a single line until used — the overwhelming majority of
 * expenses are nobody's but yours, and a split UI that is always expanded taxes every
 * solo coffee to serve the occasional group dinner.
 *
 * PRIVACY: we never read the contact book in bulk and never upload it. The picker asks
 * the OS for names, the user chooses individuals, and only those names (plus the
 * device-local contact id, so the same person is recognisable next time) are stored. No
 * phone numbers, no emails, no addresses — we have no use for them, so we do not take
 * them.
 */
export function SplitWith({ billMinor, currency, value, onChange }: Props) {
  const { people, payer } = value;

  const [picking, setPicking] = useState(false);
  // expo-contacts (SDK 54) splits the base Contact — which no longer carries an id — from
  // ExistingContact, the shape the store returns, which does. getContactsAsync yields the
  // latter, and the id is what lets the same person be recognised across expenses.
  const [contacts, setContacts] = useState<Contacts.ExistingContact[]>([]);
  const [search, setSearch] = useState('');
  const [permissionError, setPermissionError] = useState<string | null>(null);

  async function openPicker() {
    const { granted } = await Contacts.requestPermissionsAsync();

    if (!granted) {
      setPermissionError(
        'Contacts access is needed to pick who you split this with. You can also add a name by hand.',
      );
      setPicking(true);
      return;
    }

    // Names only. We ask for the minimum the picker needs to be usable.
    const { data } = await Contacts.getContactsAsync({
      fields: [Contacts.Fields.Name],
      sort: Contacts.SortTypes.FirstName,
    });

    setContacts(data.filter((c) => Boolean(c.name)));
    setPermissionError(null);
    setPicking(true);
  }

  /**
   * Re-split evenly across everyone at the table, INCLUDING you.
   *
   * splitEvenly hands out the remainder one paise at a time, so the shares always sum
   * exactly to the bill — ₹1,000 between 3 is 333.34 / 333.33 / 333.33, never a vanished
   * rupee. You take the first share, which is where any spare paise lands: better you
   * absorb it than dun a friend for it.
   */
  function rebalance(next: SplitPerson[]): SplitPerson[] {
    if (billMinor === null || next.length === 0) return next;

    // +1 for you — a participant in the split, but not in this list.
    const shares = splitEvenly(billMinor, next.length + 1);
    return next.map((p, i) => ({ ...p, shareMinor: shares[i + 1] ?? 0 }));
  }

  function addPerson(person: { name: string; contactId: string | null }) {
    if (people.some((p) => p.contactId !== null && p.contactId === person.contactId)) {
      return;
    }
    onChange({ ...value, people: rebalance([...people, { ...person, shareMinor: 0 }]) });
  }

  function removePerson(index: number) {
    const removed = people[index];
    const next = rebalance(people.filter((_, i) => i !== index));

    // Removing the person who paid cannot leave a payer who is no longer on the split.
    const stillPaying =
      payer && removed && payer.name === removed.name && payer.contactId === removed.contactId
        ? null
        : payer;

    onChange({ people: next, payer: stillPaying });
  }

  const owed = people.reduce((acc, p) => acc + p.shareMinor, 0);
  const myShare = billMinor !== null ? Math.max(0, billMinor - owed) : 0;

  const filtered = contacts.filter((c) =>
    (c.name ?? '').toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <View style={styles.wrap}>
      {people.length === 0 ? (
        <Touchable
          style={styles.addRow}
          onPress={() => void openPicker()}
          accessibilityRole="button"
          accessibilityLabel="Split this expense with people"
        >
          <UserPlus size={18} color={palette.stoneMuted} strokeWidth={1.8} />
          <Text variant="bodyMedium" color={palette.stoneMuted}>
            Split with people
          </Text>
        </Touchable>
      ) : (
        <>
          <Text variant="label" color={palette.stoneMuted}>
            Split with
          </Text>

          <View style={styles.chips}>
            {people.map((person, i) => (
              <Touchable
                key={`${person.contactId ?? person.name}:${i}`}
                style={styles.person}
                onPress={() => removePerson(i)}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${person.name} from this split`}
              >
                <Text variant="caption" color={ACCENT.text}>
                  {person.name}
                </Text>
                <Text variant="caption" color={palette.stoneFaint}>
                  {formatMoney(asMinor(person.shareMinor), currency)}
                </Text>
                <X size={13} color={palette.stoneFaint} strokeWidth={2} />
              </Touchable>
            ))}

            <Chip
              label="+ Add"
              accent={ACCENT.text}
              onPress={() => void openPicker()}
              accessibilityLabel="Add another person"
            />
          </View>

          {/*
            Who actually paid the venue.
            
            The default is you, because it usually is. But when a friend picks up the bill,
            the expense must record YOUR SHARE, not the whole thing — you never had the
            ₹1,000, and logging it would quadruple your Friday spending on a meal someone
            else bought.
          */}
          <Text variant="label" color={palette.stoneMuted} style={{ marginTop: spacing.md }}>
            Who paid?
          </Text>

          <View style={styles.chips}>
            <Chip
              label="I paid"
              selected={payer === null}
              onPress={() => onChange({ ...value, payer: null })}
              accessibilityLabel="You paid the bill"
            />

            {people.map((person, i) => {
              const paying =
                payer?.name === person.name && payer?.contactId === person.contactId;

              return (
                <Chip
                  key={`payer:${person.contactId ?? person.name}:${i}`}
                  label={person.name}
                  selected={paying}
                  onPress={() =>
                    onChange({
                      ...value,
                      payer: { name: person.name, contactId: person.contactId },
                    })
                  }
                  accessibilityLabel={`${person.name} paid the bill`}
                />
              );
            })}
          </View>

          {billMinor !== null ? (
            <Card style={styles.summary} elevated={false}>
              {payer === null ? (
                <>
                  <View style={styles.summaryRow}>
                    <Text variant="caption" color={palette.stoneMuted}>
                      Your share
                    </Text>
                    <Text variant="bodyMedium">
                      {formatMoney(asMinor(myShare), currency)}
                    </Text>
                  </View>
                  <View style={styles.summaryRow}>
                    <Text variant="caption" color={palette.stoneMuted}>
                      Owed to you
                    </Text>
                    <Text variant="bodyMedium" color={ACCENT.text}>
                      {formatMoney(asMinor(owed), currency)}
                    </Text>
                  </View>
                </>
              ) : (
                <>
                  <View style={styles.summaryRow}>
                    <Text variant="caption" color={palette.stoneMuted}>
                      {payer.name} paid
                    </Text>
                    <Text variant="bodyMedium" color={palette.stoneMuted}>
                      {formatMoney(asMinor(billMinor), currency)}
                    </Text>
                  </View>

                  {/* The only number that becomes an expense. */}
                  <View style={[styles.summaryRow, styles.summaryTotal]}>
                    <Text variant="caption" color={palette.stoneMuted}>
                      Logged as your expense
                    </Text>
                    <Text variant="cardTitle">
                      {formatMoney(asMinor(myShare), currency)}
                    </Text>
                  </View>
                </>
              )}
            </Card>
          ) : null}
        </>
      )}

      <ContactPicker
        visible={picking}
        contacts={filtered}
        search={search}
        onSearch={setSearch}
        permissionError={permissionError}
        selectedIds={people.map((p) => p.contactId).filter((id): id is string => id !== null)}
        onPick={(person) => addPerson(person)}
        onClose={() => {
          setPicking(false);
          setSearch('');
        }}
      />
    </View>
  );
}

function ContactPicker({
  visible,
  contacts,
  search,
  onSearch,
  permissionError,
  selectedIds,
  onPick,
  onClose,
}: {
  visible: boolean;
  contacts: Contacts.ExistingContact[];
  search: string;
  onSearch: (v: string) => void;
  permissionError: string | null;
  selectedIds: string[];
  onPick: (p: { name: string; contactId: string | null }) => void;
  onClose: () => void;
}) {
  const [manual, setManual] = useState('');

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      {/*
        SafeAreaProvider again, INSIDE the modal.

        A React Native Modal renders in its own native view hierarchy, outside the
        provider mounted at the app root — so `SafeAreaView` there reports zero insets
        and the header slides under the status bar and the notch. Re-providing inside the
        modal is the supported fix, not a hack.
      */}
      <SafeAreaProvider>
        <SafeAreaView style={styles.sheet} edges={['top', 'bottom']}>
          <View style={styles.sheetHeader}>
            <Text variant="heading">Split with</Text>
            <Touchable
              onPress={onClose}
              style={styles.close}
              haptic={false}
              accessibilityRole="button"
              accessibilityLabel="Done"
            >
              <X size={22} color={palette.stone} strokeWidth={1.8} />
            </Touchable>
          </View>

          {/* Always available, so a denied or empty contact book is never a dead end. */}
          <View style={styles.manual}>
            <View style={{ flex: 1 }}>
              <Input
                value={manual}
                onChangeText={setManual}
                placeholder="Add a name"
                accessibilityLabel="Add a person by name"
                returnKeyType="done"
                onSubmitEditing={() => {
                  if (manual.trim().length === 0) return;
                  onPick({ name: manual.trim(), contactId: null });
                  setManual('');
                }}
              />
            </View>

            <Button
              label="Add"
              fullWidth={false}
              disabled={manual.trim().length === 0}
              onPress={() => {
                onPick({ name: manual.trim(), contactId: null });
                setManual('');
              }}
            />
          </View>

          {permissionError ? (
            <Text variant="caption" color={palette.stoneMuted} style={styles.permission}>
              {permissionError}
            </Text>
          ) : (
            <>
              <Text variant="label" color={palette.stoneMuted} style={styles.divider}>
                From your contacts
              </Text>

              <Input
                value={search}
                onChangeText={onSearch}
                placeholder="Search"
                accessibilityLabel="Search contacts"
                autoCorrect={false}
                autoCapitalize="none"
              />

              <FlatList
                data={contacts}
                keyExtractor={(c) => c.id ?? c.name ?? ''}
                keyboardShouldPersistTaps="handled"
                style={styles.list}
                ListEmptyComponent={
                  <Text variant="caption" color={palette.stoneFaint} style={styles.empty}>
                    No matching contacts.
                  </Text>
                }
                renderItem={({ item }) => {
                  const chosen = item.id !== undefined && selectedIds.includes(item.id);

                  return (
                    <Touchable
                      style={styles.contact}
                      onPress={() => onPick({ name: item.name!, contactId: item.id ?? null })}
                      accessibilityRole="button"
                      accessibilityState={{ selected: chosen }}
                      accessibilityLabel={item.name}
                    >
                      <Text
                        variant="bodyMedium"
                        color={chosen ? palette.stoneFaint : palette.stone}
                        style={{ flex: 1 }}
                      >
                        {item.name}
                      </Text>
                      {chosen ? (
                        <Check size={18} color={palette.sage} strokeWidth={2.2} />
                      ) : null}
                    </Touchable>
                  );
                }}
              />
            </>
          )}
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  person: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: ACCENT.base,
    backgroundColor: ACCENT.wash,
  },
  summary: {
    gap: spacing.xs,
    backgroundColor: palette.sand,
    borderRadius: radius.md,
    marginTop: spacing.md,
  },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between' },
  summaryTotal: {
    borderTopWidth: 1,
    borderTopColor: palette.surfaceDim,
    paddingTop: spacing.sm,
    marginTop: spacing.xs,
  },

  sheet: { flex: 1, backgroundColor: palette.bone, paddingHorizontal: spacing.lg },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 56,
    marginBottom: spacing.lg,
  },
  close: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -spacing.md,
  },
  permission: { marginTop: spacing.lg },
  manual: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  divider: { marginBottom: spacing.sm },
  list: { marginTop: spacing.sm },
  empty: { paddingVertical: spacing.xl, textAlign: 'center' },
  contact: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingHorizontal: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: palette.surfaceDim,
  },
});

/** Re-derive the shares when the bill changes after people were already added. */
export function resplit(
  state: SplitState,
  billText: string,
  currency: string,
): SplitState {
  const bill = parseMoneyInput(billText, currency);
  if (bill === null || state.people.length === 0) return state;

  const shares = splitEvenly(bill, state.people.length + 1);

  return {
    ...state,
    people: state.people.map((p, i) => ({ ...p, shareMinor: shares[i + 1] ?? 0 })),
  };
}
