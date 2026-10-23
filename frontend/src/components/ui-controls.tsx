"use client";

import { useId } from "react";
import type {
  ButtonHTMLAttributes,
  ComponentProps,
  TextareaHTMLAttributes,
} from "react";

export function Button({
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={`button ${className}`} {...props} />;
}

export function Input({ className = "", ...props }: ComponentProps<"input">) {
  return <input className={`field ${className}`} {...props} />;
}

export function Textarea({
  className = "",
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`field ${className}`} {...props} />;
}

export function LabeledTextarea({
  label,
  id: suppliedId,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block font-medium">
        {label}
      </label>
      <Textarea id={id} {...props} />
    </div>
  );
}
