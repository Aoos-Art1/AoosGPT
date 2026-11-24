"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// The shadcn/ui Radix composition pattern, adapted to AoosGPT's shared theme.
// https://ui.shadcn.com/docs/components/button
export const buttonVariants = cva("button", {
  variants: {
    variant: {
      default: "button-primary",
      secondary: "button-secondary",
      outline: "button-secondary",
      ghost: "button-ghost",
      destructive: "button-danger",
      link: "button-ghost underline underline-offset-4",
    },
    size: {
      default: "",
      sm: "min-h-8! px-3! py-1! text-xs!",
      lg: "min-h-12! px-6!",
      icon: "size-10! min-h-10! p-0!",
    },
  },
  defaultVariants: { variant: "default", size: "default" },
});

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants> & { asChild?: boolean };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ asChild = false, variant, size, className, ...props }, ref) {
  const Component = asChild ? Slot : "button";
  return <Component data-slot="button" ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
});
