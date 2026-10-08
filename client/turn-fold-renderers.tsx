import React, { useMemo, type ComponentType } from "react";
import { View } from "react-native";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { buildThemeTokens } from "./components/theme-tokens";
import { hostFontEscape } from "./components/host-font-escape";
import { WorkedFor } from "./components/worked-for";
import { foldedRowMarker } from "./components/fold-style";
import { useEnhancerPreferences } from "./preferences";
import { useTurnFold, type FoldKind } from "./turn-fold";

/**
 * Wraps a timeline renderer so its row takes part in turn folding. The row
 * draws nothing while its turn is folded, except the turn's first work row,
 * which draws the "Worked for" header in its place.
 */
export function withTurnFold<Data>(
  kind: FoldKind,
  Renderer: ComponentType<PluginTimelineItemProps<Data>>,
): ComponentType<PluginTimelineItemProps<Data>> {
  function Folded(props: PluginTimelineItemProps<Data>) {
    const preferences = useEnhancerPreferences();
    const data = props.item.data as { callId?: unknown };
    const fold = useTurnFold({
      agentId: props.agentId,
      timestamp: props.timestamp,
      kind,
      callId: typeof data.callId === "string" ? data.callId : undefined,
      enabled: preferences.foldTurns,
      replies: preferences.assistantMarkdown,
    });
    const tokens = useMemo(
      () => buildThemeTokens(props.theme.colors, preferences),
      [props.theme.colors, preferences],
    );

    const header = fold.header ? (
      <View {...hostFontEscape}>
        <WorkedFor
          agentId={props.agentId}
          turn={fold.header.turn}
          expanded={fold.header.expanded}
          tokens={tokens}
        />
      </View>
    ) : null;

    if (fold.hidden) return header ?? <View {...foldedRowMarker} />;
    return (
      <>
        {header}
        <Renderer {...props} />
      </>
    );
  }
  Folded.displayName = `TurnFold(${Renderer.displayName ?? Renderer.name})`;
  return Folded;
}
