/**
 * Swiper 11.0.3
 * Most modern mobile touch slider and framework with hardware accelerated transitions
 * https://swiperjs.com
 *
 * Copyright 2014-2023 Vladimir Kharlampidi
 *
 * Released under the MIT License
 *
 * Released on: November 6, 2023
 */

import { S as Swiper } from './shared/swiper-core.mjs';
import Navigation from './modules/navigation.mjs';
import Pagination from './modules/pagination.mjs';
import Scrollbar from './modules/scrollbar.mjs';
import A11y from './modules/a11y.mjs';
import Autoplay from './modules/autoplay.mjs';
import Thumb from './modules/thumbs.mjs';

// Swiper Class
const modules = [Navigation, Pagination, Scrollbar, A11y, Autoplay, Thumb];
Swiper.use(modules);

export { Swiper, Swiper as default };
