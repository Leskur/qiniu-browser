import { useId, useState } from "react";
import { Sun, Moon, Monitor } from "lucide-react";
import { useAppStore } from "../store";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group";

const themes = [
  { value: "light", label: "浅色", icon: Sun },
  { value: "dark", label: "深色", icon: Moon },
  { value: "system", label: "跟随系统", icon: Monitor },
] as const;

export function ThemeSwitcher() {
  const theme = useAppStore(state => state.theme);
  const setTheme = useAppStore(state => state.setTheme);
  const [open, setOpen] = useState(false);
  const id = useId();
  const current = themes.find(item => item.value === theme) ?? themes[2];
  const Icon = current.icon;

  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger render={<Button variant="ghost" size="icon-sm" className="shrink-0 text-muted-foreground" />} aria-label="切换主题" title={`切换主题：${current.label}`}>
      <Icon />
    </PopoverTrigger>
    <PopoverContent side="top" align="end" className="w-40 p-1">
      <RadioGroup aria-label="主题模式" value={theme} className="gap-0" onValueChange={value => {
        if (value === "light" || value === "dark" || value === "system") {
          setTheme(value);
          setOpen(false);
        }
      }}>
        {themes.map(({ value, label, icon: ThemeIcon }) => <Label key={value} htmlFor={`${id}-${value}`} className={`cursor-pointer gap-2 rounded-md px-2 py-2 hover:bg-accent ${theme === value ? "bg-accent" : ""}`}>
          <ThemeIcon className="size-4 text-muted-foreground" />
          <span className="flex-1 text-xs font-normal">{label}</span>
          <RadioGroupItem id={`${id}-${value}`} value={value} />
        </Label>)}
      </RadioGroup>
    </PopoverContent>
  </Popover>;
}
