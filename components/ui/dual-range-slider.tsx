"use client"

import * as React from "react"
import { Slider as SliderPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function DualRangeSlider({
  className,
  label,
  labelPosition = "top",
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root> & {
  labelPosition?: "top" | "bottom"
  label?: (value: number | undefined) => React.ReactNode
}) {
  // Uso no controlado (defaultValue, sin value): antes caía directo a
  // [min, max] e ignoraba defaultValue, mostrando labels equivocadas en el
  // primer render (hallazgo de code-review, 24-ago-2026).
  const values = Array.isArray(props.value)
    ? props.value
    : Array.isArray(props.defaultValue)
      ? props.defaultValue
      : [props.min, props.max]

  return (
    <SliderPrimitive.Root
      data-slot="dual-range-slider"
      className={cn("relative flex w-full touch-none select-none items-center", className)}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="dual-range-slider-track"
        className="relative h-2 w-full grow overflow-hidden rounded-full bg-secondary"
      >
        <SliderPrimitive.Range
          data-slot="dual-range-slider-range"
          className="absolute h-full bg-primary"
        />
      </SliderPrimitive.Track>
      {values.map((value, index) => (
        <SliderPrimitive.Thumb
          key={index}
          data-slot="dual-range-slider-thumb"
          className="relative block h-4 w-4 rounded-full border-2 border-primary bg-background ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
        >
          {label && (
            <span
              className={cn(
                "absolute flex w-full justify-center",
                labelPosition === "top" && "-top-7",
                labelPosition === "bottom" && "top-4"
              )}
            >
              {label(value)}
            </span>
          )}
        </SliderPrimitive.Thumb>
      ))}
    </SliderPrimitive.Root>
  )
}

export { DualRangeSlider }
