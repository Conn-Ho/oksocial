'use client';

import { DetailedHTMLProps, FC, InputHTMLAttributes, useMemo } from 'react';
import clsx from 'clsx';
import { useFormContext } from 'react-hook-form';
import { TranslatedLabel } from '../translation/translated-label';

export const Textarea: FC<
  DetailedHTMLProps<
    InputHTMLAttributes<HTMLTextAreaElement>,
    HTMLTextAreaElement
  > & {
    error?: any;
    disableForm?: boolean;
    label: string;
    name: string;
    translationKey?: string;
    translationParams?: Record<string, string | number>;
  }
> = (props) => {
  const {
    label,
    className,
    disableForm,
    error,
    translationKey,
    translationParams,
    ...rest
  } = props;
  const form = useFormContext();
  const err = useMemo(() => {
    if (error) return error;
    if (!form || !form.formState.errors[props?.name!]) return;
    return form?.formState?.errors?.[props?.name!]?.message! as string;
  }, [form?.formState?.errors?.[props?.name!]?.message, error]);
  return (
    <div
      className={clsx(
        'flex flex-col gap-[6px]',
        props.disabled && 'opacity-50'
      )}
    >
      <div className="text-[13px] font-[600] text-textColor">
        <TranslatedLabel
          label={label}
          translationKey={translationKey}
          translationParams={translationParams}
        />
      </div>
      <textarea
        {...(disableForm ? {} : form.register(props.name))}
        className={clsx(
          'bg-newBgColorInner min-h-[150px] p-[14px] outline-none border-newTableBorder border rounded-[8px] text-[14px] text-textColor placeholder:text-textItemBlur transition-[border-color,box-shadow] duration-150 focus-visible:outline-none focus:border-btnPrimary focus:ring-[3px] focus:ring-btnPrimary/15',
          className
        )}
        {...rest}
      />
      <div className="text-red-400 text-[12px]">{err || <>&nbsp;</>}</div>
    </div>
  );
};
