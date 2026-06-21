import * as React from "react";
import { motion, MotionConfig, useReducedMotion } from "framer-motion";
import * as RechartsPrimitive from "recharts";

import { cn } from "../../lib/utils";

// Adapted from the shadcn/ui chart recipe for this repo: framer-motion instead
// of motion/react, app tokens (ink/brand) instead of shadcn CSS vars, and the
// speculative reduced-motion override context dropped — useReducedMotion covers
// the one case we have.

const THEMES = { light: "", dark: ".dark" } as const;

const CHART_BAR_ANIMATION_DURATION = 480;
const CHART_BAR_ANIMATION_EASING = "ease-out" as const;
const CHART_BAR_STAGGER_MS = 32;

const chartTooltipFade = { duration: 0.14, ease: [0.22, 1, 0.36, 1] } as const;

export type ChartConfig = Record<
  string,
  {
    label?: React.ReactNode;
    icon?: React.ComponentType;
  } & (
    | { color?: string; theme?: never }
    | { color?: never; theme: Record<keyof typeof THEMES, string> }
  )
>;

type ChartContextProps = {
  config: ChartConfig;
  reducedMotion: boolean;
  barAnimationActive: boolean;
};

const ChartContext = React.createContext<ChartContextProps | null>(null);

function useChart() {
  const context = React.useContext(ChartContext);
  if (!context) throw new Error("useChart must be used within a <ChartContainer />");
  return context;
}

function ChartContainer({
  id,
  className,
  children,
  config,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  config: ChartConfig;
  children: React.ComponentProps<
    typeof RechartsPrimitive.ResponsiveContainer
  >["children"];
}) {
  const uniqueId = React.useId();
  const chartId = `chart-${id ?? uniqueId.replace(/:/g, "")}`;
  const reducedMotion = useReducedMotion() ?? false;
  const [barAnimationActive, setBarAnimationActive] = React.useState(
    () => !reducedMotion
  );

  React.useEffect(() => {
    if (reducedMotion) {
      setBarAnimationActive(false);
      return;
    }
    const t = window.setTimeout(
      () => setBarAnimationActive(false),
      CHART_BAR_ANIMATION_DURATION + CHART_BAR_STAGGER_MS * 3
    );
    return () => window.clearTimeout(t);
  }, [reducedMotion]);

  return (
    <ChartContext.Provider value={{ config, reducedMotion, barAnimationActive }}>
      <MotionConfig reducedMotion={reducedMotion ? "always" : "user"}>
        <div
          className={cn(
            "flex aspect-video min-h-[12rem] w-full justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-brand-400 [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-brand-200 [&_.recharts-curve.recharts-tooltip-cursor]:stroke-brand-200 [&_.recharts-dot[stroke='#fff']]:stroke-transparent [&_.recharts-layer]:outline-hidden [&_.recharts-polar-grid_[stroke='#ccc']]:stroke-brand-200 [&_.recharts-radial-bar-background-sector]:fill-brand-100 [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-brand-100 [&_.recharts-reference-line_[stroke='#ccc']]:stroke-brand-200 [&_.recharts-sector[stroke='#fff']]:stroke-transparent [&_.recharts-sector]:outline-hidden [&_.recharts-surface]:outline-hidden",
            className
          )}
          data-chart={chartId}
          {...props}
        >
          <ChartStyle config={config} id={chartId} />
          <RechartsPrimitive.ResponsiveContainer width="100%" height="100%">
            {children}
          </RechartsPrimitive.ResponsiveContainer>
        </div>
      </MotionConfig>
    </ChartContext.Provider>
  );
}

const ChartStyle = ({ id, config }: { id: string; config: ChartConfig }) => {
  const colorConfig = Object.entries(config).filter(
    ([, c]) => c.theme ?? c.color
  );
  if (!colorConfig.length) return null;
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: Object.entries(THEMES)
          .map(
            ([theme, prefix]) => `
${prefix} [data-chart=${id}] {
${colorConfig
  .map(([key, itemConfig]) => {
    const color =
      itemConfig.theme?.[theme as keyof typeof itemConfig.theme] ??
      itemConfig.color;
    return color ? `  --color-${key}: ${color};` : null;
  })
  .join("\n")}
}
`
          )
          .join("\n"),
      }}
    />
  );
};

const ChartTooltip = RechartsPrimitive.Tooltip;

// recharts strips payload/label from its public Tooltip/Legend prop types (they
// arrive at runtime via cloneElement), so type the bits we read ourselves.
type TooltipItem = {
  value?: number | string;
  name?: number | string;
  dataKey?: number | string;
  color?: string;
  type?: string;
  payload?: Record<string, unknown> & { fill?: string };
};
type LegendItem = {
  value?: number | string;
  dataKey?: number | string;
  color?: string;
  type?: string;
};

function ChartBar({
  animationBegin,
  animationDuration,
  animationEasing,
  isAnimationActive,
  seriesIndex = 0,
  ...props
}: React.ComponentProps<typeof RechartsPrimitive.Bar> & {
  /** Staggers bar growth when plotting multiple series (0, 1, 2, …). */
  seriesIndex?: number;
}) {
  const { barAnimationActive, reducedMotion } = useChart();
  const shouldAnimate = !reducedMotion && (isAnimationActive ?? barAnimationActive);
  return (
    <RechartsPrimitive.Bar
      {...props}
      animationBegin={animationBegin ?? seriesIndex * CHART_BAR_STAGGER_MS}
      animationDuration={
        shouldAnimate ? (animationDuration ?? CHART_BAR_ANIMATION_DURATION) : 0
      }
      animationEasing={animationEasing ?? CHART_BAR_ANIMATION_EASING}
      isAnimationActive={shouldAnimate}
    />
  );
}

function ChartTooltipContent({
  active,
  payload,
  className,
  indicator = "dot",
  hideLabel = false,
  hideIndicator = false,
  label,
  labelFormatter,
  labelClassName,
  formatter,
  color,
  nameKey,
  labelKey,
}: Omit<React.ComponentProps<"div">, "color"> & {
  active?: boolean;
  payload?: TooltipItem[];
  label?: React.ReactNode;
  labelFormatter?: (
    value: React.ReactNode,
    payload: TooltipItem[]
  ) => React.ReactNode;
  labelClassName?: string;
  formatter?: (
    value: TooltipItem["value"],
    name: TooltipItem["name"],
    item: TooltipItem,
    index: number,
    payload: TooltipItem["payload"]
  ) => React.ReactNode;
  color?: string;
  hideLabel?: boolean;
  hideIndicator?: boolean;
  indicator?: "line" | "dot" | "dashed";
  nameKey?: string;
  labelKey?: string;
}) {
  const { config, reducedMotion } = useChart();

  const tooltipLabel = React.useMemo(() => {
    if (hideLabel || !payload?.length) return null;
    const [item] = payload;
    const key = `${labelKey ?? item?.dataKey ?? item?.name ?? "value"}`;
    const itemConfig = getPayloadConfigFromPayload(config, item, key);
    const value =
      !labelKey && typeof label === "string"
        ? (config[label]?.label ?? label)
        : itemConfig?.label;
    if (labelFormatter)
      return (
        <div className={cn("font-medium", labelClassName)}>
          {labelFormatter(value, payload)}
        </div>
      );
    if (!value) return null;
    return <div className={cn("font-medium", labelClassName)}>{value}</div>;
  }, [label, labelFormatter, payload, hideLabel, labelClassName, config, labelKey]);

  if (!(active && payload?.length)) return null;

  const nestLabel = payload.length === 1 && indicator !== "dot";

  return (
    <motion.div
      animate={{ opacity: 1 }}
      className={cn(
        "grid min-w-32 items-start gap-1.5 rounded-lg border border-brand-200 bg-white px-2.5 py-1.5 text-xs shadow-xl dark:border-[#2C2C2E] dark:bg-[#1C1C1E]",
        className
      )}
      initial={{ opacity: reducedMotion ? 1 : 0 }}
      transition={reducedMotion ? { duration: 0 } : chartTooltipFade}
    >
      {nestLabel ? null : tooltipLabel}
      <div className="grid gap-1.5">
        {payload
          .filter((item) => item.type !== "none")
          .map((item, index) => {
            const key = `${nameKey ?? item.name ?? item.dataKey ?? "value"}`;
            const itemConfig = getPayloadConfigFromPayload(config, item, key);
            const indicatorColor = color ?? item.payload?.fill ?? item.color;
            return (
              <div
                key={index}
                className={cn(
                  "flex w-full flex-wrap items-stretch gap-2 [&>svg]:h-2.5 [&>svg]:w-2.5 [&>svg]:text-brand-400",
                  indicator === "dot" && "items-center"
                )}
              >
                {formatter && item?.value !== undefined && item.name ? (
                  formatter(item.value, item.name, item, index, item.payload)
                ) : (
                  <>
                    {itemConfig?.icon ? (
                      <itemConfig.icon />
                    ) : (
                      !hideIndicator && (
                        <div
                          className={cn(
                            "shrink-0 rounded-[2px] border-(--color-border) bg-(--color-bg)",
                            {
                              "h-2.5 w-2.5": indicator === "dot",
                              "w-1": indicator === "line",
                              "w-0 border-[1.5px] border-dashed bg-transparent":
                                indicator === "dashed",
                              "my-0.5": nestLabel && indicator === "dashed",
                            }
                          )}
                          style={
                            {
                              "--color-bg": indicatorColor,
                              "--color-border": indicatorColor,
                            } as React.CSSProperties
                          }
                        />
                      )
                    )}
                    <div
                      className={cn(
                        "flex flex-1 justify-between leading-none",
                        nestLabel ? "items-end" : "items-center"
                      )}
                    >
                      <div className="grid gap-1.5">
                        {nestLabel ? tooltipLabel : null}
                        <span className="text-brand-400">
                          {itemConfig?.label ?? item.name}
                        </span>
                      </div>
                      {item.value != null && (
                        <span className="font-medium font-mono text-ink tabular-nums">
                          {typeof item.value === "number"
                            ? item.value.toLocaleString()
                            : String(item.value)}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
      </div>
    </motion.div>
  );
}

const ChartLegend = RechartsPrimitive.Legend;

function ChartLegendContent({
  className,
  hideIcon = false,
  payload,
  verticalAlign = "bottom",
  nameKey,
}: React.ComponentProps<"div"> & {
  hideIcon?: boolean;
  nameKey?: string;
  payload?: LegendItem[];
  verticalAlign?: "top" | "bottom";
}) {
  const { config } = useChart();
  if (!payload?.length) return null;
  return (
    <div
      className={cn(
        "flex items-center justify-center gap-4",
        verticalAlign === "top" ? "pb-3" : "pt-3",
        className
      )}
    >
      {payload
        .filter((item) => item.type !== "none")
        .map((item, index) => {
          const key = `${nameKey ?? item.dataKey ?? "value"}`;
          const itemConfig = getPayloadConfigFromPayload(config, item, key);
          return (
            <div
              key={index}
              className="flex items-center gap-1.5 [&>svg]:h-3 [&>svg]:w-3 [&>svg]:text-brand-400"
            >
              {itemConfig?.icon && !hideIcon ? (
                <itemConfig.icon />
              ) : (
                <div
                  className="h-2 w-2 shrink-0 rounded-[2px]"
                  style={{ backgroundColor: item.color }}
                />
              )}
              {itemConfig?.label}
            </div>
          );
        })}
    </div>
  );
}

function getPayloadConfigFromPayload(
  config: ChartConfig,
  payload: unknown,
  key: string
) {
  if (typeof payload !== "object" || payload === null) return undefined;
  const payloadPayload =
    "payload" in payload &&
    typeof payload.payload === "object" &&
    payload.payload !== null
      ? payload.payload
      : undefined;
  let configLabelKey: string = key;
  if (key in payload && typeof payload[key as keyof typeof payload] === "string") {
    configLabelKey = payload[key as keyof typeof payload] as string;
  } else if (
    payloadPayload &&
    key in payloadPayload &&
    typeof payloadPayload[key as keyof typeof payloadPayload] === "string"
  ) {
    configLabelKey = payloadPayload[key as keyof typeof payloadPayload] as string;
  }
  return configLabelKey in config ? config[configLabelKey] : config[key];
}

export {
  ChartBar,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  ChartStyle,
};
