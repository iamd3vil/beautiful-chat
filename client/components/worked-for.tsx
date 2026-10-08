import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Glyph } from "./glyph";
import { Rotate } from "./motion";
import { unselectable } from "./selection";
import type { ExtendedThemeTokens } from "./theme-tokens";
import { formatWorkedDuration, toggleTurn, type TurnSpan } from "../turn-fold";

interface WorkedForProps {
  agentId: string;
  turn: TurnSpan;
  expanded: boolean;
  tokens: ExtendedThemeTokens;
}

/** The single row a finished turn's work folds into. */
export function WorkedFor({ agentId, turn, expanded, tokens }: WorkedForProps) {
  const styles = useMemo(
    () =>
      StyleSheet.create({
        row: {
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          alignSelf: "flex-start",
          paddingVertical: 6,
        },
        label: {
          fontFamily: tokens.fontUi,
          fontSize: 13,
          color: tokens.foregroundMuted,
          ...unselectable,
        },
        rule: {
          height: 1,
          backgroundColor: tokens.borderSubtle,
          marginBottom: 6,
        },
      }),
    [tokens],
  );

  const duration = formatWorkedDuration(turn.lastWorkAt - turn.startAt);
  const steps = `${turn.workCount} ${turn.workCount === 1 ? "step" : "steps"}`;

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`Worked for ${duration}, ${steps}. ${expanded ? "Collapse" : "Expand"}`}
        onPress={() => toggleTurn(agentId, turn)}
        style={styles.row}
      >
        <Text style={styles.label}>Worked for {duration}</Text>
        <Rotate active={expanded} degrees={90}>
          <Glyph name="ChevronRight" size={12} color={tokens.foregroundMuted} />
        </Rotate>
      </Pressable>
      <View style={styles.rule} />
    </View>
  );
}
