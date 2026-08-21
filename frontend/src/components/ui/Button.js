import * as React from "react"
import { cn } from "@/lib/utils"

const Button = React.forwardRef(({ className, variant = "default", size = "default", ...props }, ref) => {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
        {
          "bg-slate-900 text-slate-50 hover:bg-slate-900/90": variant === "default",
          "bg-blue-600 text-white hover:bg-blue-700 shadow-sm": variant === "primary",
          "bg-white text-slate-700 border border-slate-200 hover:bg-slate-100 hover:text-slate-900": variant === "outline",
          "hover:bg-slate-100 hover:text-slate-900 text-slate-700": variant === "ghost",
          "h-10 px-4 py-2": size === "default",
          "h-11 rounded-md px-8": size === "lg",
          "h-10 w-10": size === "icon",
        },
        className
      )}
      {...props}
    />
  )
})
Button.displayName = "Button"

export { Button }
