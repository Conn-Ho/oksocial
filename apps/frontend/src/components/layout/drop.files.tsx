import { useDropzone } from 'react-dropzone';
import { FC, ReactNode } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import clsx from 'clsx';
import { useToaster } from '@gitroom/react/toaster/toaster';
export const DropFiles: FC<{
  children: ReactNode;
  className?: string;
  onDrop: (files: File[]) => void;
  disabled?: boolean;
}> = (props) => {
  const t = useT();
  const toaster = useToaster();

  const { getRootProps, isDragActive } = useDropzone({
    onDrop: (files) => {
      if (props.disabled) {
        toaster.show(
          t('upload_in_progress_try_later', '正在上传，请等上传完成后再试。'),
          'warning'
        );
        return ;
      }
      props.onDrop(files);
    },
  });
  return (
    <div {...getRootProps()} className={clsx("relative", props.className)}>
      {isDragActive && (
        <div className="absolute start-0 top-0 w-full h-full bg-black/90 flex items-center justify-center z-[200] animate-normalFadeIn">
          {t('drag_n_drop_some_files_here', 'Drag n drop some files here')}
        </div>
      )}
      {props.children}
    </div>
  );
};
