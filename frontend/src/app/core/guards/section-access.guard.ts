import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs/operators';
import { SectionAccessService } from '../services/section-access.service';

export const sectionAccessGuard: CanActivateFn = (route) => {
  const sectionAccess = inject(SectionAccessService);
  const router = inject(Router);
  const sectionKey = route.data?.['sectionKey'];

  if (!sectionKey) {
    return true;
  }

  return sectionAccess.load(false).pipe(
    map((sections) => {
      const match = sections.find(s => s.section_key === sectionKey);
      const isAllowed = !match || sectionAccess.isVisible(match);

      if (isAllowed) {
        return true;
      }

      const fallback = sectionAccess.getFirstVisiblePath(sections);
      return router.createUrlTree([fallback]);
    })
  );
};
