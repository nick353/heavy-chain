type OverflowTarget = {
  style: { overflow: string };
};

export const createModalBodyScrollLock = () => {
  let lockCount = 0;
  let originalOverflow = '';

  const acquire = (target: OverflowTarget) => {
    if (lockCount === 0) {
      originalOverflow = target.style.overflow;
      target.style.overflow = 'hidden';
    }
    lockCount += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      lockCount = Math.max(0, lockCount - 1);
      if (lockCount === 0) {
        target.style.overflow = originalOverflow;
      }
    };
  };

  return {
    acquire,
    getLockCount: () => lockCount,
  };
};

export const modalBodyScrollLock = createModalBodyScrollLock();
