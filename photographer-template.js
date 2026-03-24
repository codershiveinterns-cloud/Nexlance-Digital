document.addEventListener('DOMContentLoaded', () => {
    const counters = document.querySelectorAll('.counter');
    const revealItems = document.querySelectorAll('.reveal');
    const formButton = document.getElementById('phFormButton');
    const formMessage = document.getElementById('phFormMessage');
    const counterObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            const target = Number(entry.target.dataset.target || 0);
            const start = performance.now();
            const duration = 1500;
            const tick = now => {
                const progress = Math.min((now - start) / duration, 1);
                entry.target.textContent = Math.floor(progress * target);
                if (progress < 1) requestAnimationFrame(tick);
                else entry.target.textContent = target;
            };
            requestAnimationFrame(tick);
            observer.unobserve(entry.target);
        });
    }, { threshold: 0.45 });
    counters.forEach(counter => counterObserver.observe(counter));
    const revealObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) entry.target.classList.add('visible');
        });
    }, { threshold: 0.18 });
    revealItems.forEach(item => revealObserver.observe(item));
    if (formButton) {
        formButton.addEventListener('click', () => {
            formMessage.textContent = 'Inquiry captured. Connect this button to your booking workflow or CRM.';
        });
    }
});
