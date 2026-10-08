import {
  Directive,
  ElementRef,
  OnDestroy,
  OnInit,
  inject,
} from '@angular/core';

/**
 * Scroll reveal for the customer experience: the element (and any `.cx-stagger` children) fade
 * and rise into place the first time it enters the viewport. Without IntersectionObserver or
 * with reduced motion it is shown immediately, so content is never hidden.
 */
@Directive({ selector: '[appReveal]', standalone: true })
export class RevealDirective implements OnInit, OnDestroy {
  private readonly el =
    inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private observer: IntersectionObserver | null = null;

  public ngOnInit(): void {
    const reduce = window.matchMedia?.(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    if (reduce || typeof IntersectionObserver === 'undefined') return;
    this.el.classList.add('cx-reveal');
    this.observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          this.el.classList.add('is-in');
          this.observer?.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -6% 0px' },
    );
    this.observer.observe(this.el);
  }

  public ngOnDestroy(): void {
    this.observer?.disconnect();
  }
}
