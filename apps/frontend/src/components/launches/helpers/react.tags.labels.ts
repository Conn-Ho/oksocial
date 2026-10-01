// What react-tag-autocomplete says on its own (its defaults are English).
// %value% is replaced by the library with the tag being typed or removed.
export const reactTagsLabels = (
  t: (key: string, fallback: string) => string
) => ({
  placeholderText: t('add_a_tag', '添加标签'),
  newOptionText: t('react_tags_new_option', '添加：%value%'),
  noOptionsText: t('react_tags_no_options', '没有找到“%value%”'),
  deleteButtonText: t('react_tags_delete', '移除 %value%'),
  ariaAddedText: t('react_tags_added', '已添加标签 %value%'),
  ariaDeletedText: t('react_tags_deleted', '已移除标签 %value%'),
  labelText: t('react_tags_label', '选择标签'),
  tagListLabelText: t('react_tags_selected', '已选标签'),
});
