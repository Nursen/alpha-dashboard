interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center">
      <div className="text-4xl mb-3">!</div>
      <p className="text-gh-red mb-2 font-medium">Something went wrong</p>
      <p className="text-gh-text-muted text-sm mb-4 max-w-md">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="px-4 py-2 text-sm bg-gh-bg-secondary border border-gh-border rounded-lg
                     hover:border-gh-accent transition-colors text-gh-text"
        >
          Try again
        </button>
      )}
    </div>
  );
}
