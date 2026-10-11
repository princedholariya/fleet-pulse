import { CanDeactivateFn } from '@angular/router';

export interface ComponentCanDeactivate {
  canDeactivate: () => boolean;
}

export const pendingChangesGuard: CanDeactivateFn<ComponentCanDeactivate> = (component) => {
  if (component && typeof component.canDeactivate === 'function') {
    return component.canDeactivate()
      ? true
      : confirm('You have unsaved changes. Are you sure you want to discard them and leave?');
  }
  return true;
};

