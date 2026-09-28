// React 19 resets a <form action={fn}> after every submit — including when the server action returns a validation error,
// which wipes everything the user typed (and silently resets selects to their first option). Forms that redirect on success
// submit through this handler instead: the action runs the same way, but the inputs keep their values on error.
import { startTransition, type FormEvent } from "react";

export function keepFormValues(dispatch: (fd: FormData) => void) {
  return (e: FormEvent<HTMLFormElement>) => {
    if (e.defaultPrevented) return; // a data-confirm prompt was declined (components/ConfirmForms)
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter;
    let fd: FormData;
    try {
      fd = new FormData(e.currentTarget, submitter ?? undefined);
    } catch {
      fd = new FormData(e.currentTarget); // older browsers: no submitter support
    }
    startTransition(() => dispatch(fd));
  };
}
