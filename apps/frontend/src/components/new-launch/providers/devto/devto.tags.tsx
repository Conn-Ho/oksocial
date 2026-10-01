'use client';

import { FC, useCallback, useEffect, useState } from 'react';
import { ReactTags } from 'react-tag-autocomplete';
import { reactTagsLabels } from '@gitroom/frontend/components/launches/helpers/react.tags.labels';
import { useCustomProviderFunction } from '@gitroom/frontend/components/launches/helpers/use.custom.provider.function';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
export const DevtoTags: FC<{
  name: string;
  label: string;
  onChange: (event: {
    target: {
      value: any[];
      name: string;
    };
  }) => void;
}> = (props) => {
  const { onChange, name, label } = props;
  const t = useT();
  const form = useSettings();
  const customFunc = useCustomProviderFunction();
  const [tags, setTags] = useState<any[]>([]);
  const { getValues } = useSettings();
  const [tagValue, setTagValue] = useState<any[]>([]);
  const onDelete = useCallback(
    (tagIndex: number) => {
      const modify = tagValue.filter((_, i) => i !== tagIndex);
      setTagValue(modify);
      form.setValue(name, modify);
    },
    [tagValue, name, form]
  );
  const onAddition = useCallback(
    (newTag: any) => {
      if (tagValue.length >= 4) {
        return;
      }
      const modify = [...tagValue, newTag];
      setTagValue(modify);
      form.setValue(name, modify);
    },
    [tagValue, name, form]
  );
  useEffect(() => {
    customFunc.get('tags').then((data) => setTags(data));
    const settings = getValues()[props.name];
    if (settings) {
      setTagValue(settings);
    }
  }, []);
  if (!tags.length) {
    return null;
  }
  return (
    <div>
      <div className={`text-[14px] mb-[6px]`}>{label}</div>
      <ReactTags
        {...reactTagsLabels(t)}
        suggestions={tags}
        selected={tagValue}
        onAdd={onAddition}
        onDelete={onDelete}
      />
    </div>
  );
};
