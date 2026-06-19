interface Props {
  src: string;
  title: string;
}

export function HtmlViewer({ src, title }: Props) {
  return (
    <iframe
      src={src}
      title={title}
      className="html-viewer"
    />
  );
}
