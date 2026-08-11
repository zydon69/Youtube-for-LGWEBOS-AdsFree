// @ts-nocheck -- vendored legacy polyfill; see docs/vendor-patches.md
//
// https://raw.githubusercontent.com/Financial-Times/polyfill-library/c25c30e4463bef60fba1213ecb697f3e3f253d7b/polyfills/DOMRect/polyfill.js
// License: MIT
//

(function (global) {
	if (typeof global.DOMRect === 'function') return;

	function number(v) {
		return v === undefined ? 0 : Number(v);
	}
	
	function different(u, v) {
		return u !== v && !(isNaN(u) && isNaN(v));
	}

	function DOMRect(xArg, yArg, wArg, hArg) {
		var x, y, width, height, left, right, top, bottom;

		x = number(xArg);
		y = number(yArg);
		width = number(wArg);
		height = number(hArg);

		Object.defineProperties(this, {
			x: {
				get: function () { return x; },
				set: function (newX) {
					newX = number(newX);
					if (different(x, newX)) {
						x = newX;
						left = right = undefined;
					}
				},
				enumerable: true
			},
			y: {
				get: function () { return y; },
				set: function (newY) {
					newY = number(newY);
					if (different(y, newY)) {
						y = newY;
						top = bottom = undefined;
					}
				},
				enumerable: true
			},
			width: {
				get: function () { return width; },
				set: function (newWidth) {
					newWidth = number(newWidth);
					if (different(width, newWidth)) {
						width = newWidth;
						left = right = undefined;
					}
				},
				enumerable: true
			},
			height: {
				get: function () { return height; },
				set: function (newHeight) {
					newHeight = number(newHeight);
					if (different(height, newHeight)) {
						height = newHeight;
						top = bottom = undefined;
					}
				},
				enumerable: true
			},
			left: {
				get: function () {
					if (left === undefined) {
						left = x + Math.min(0, width);
					}
					return left;
				},
				enumerable: true
			},
			right: {
				get: function () {
					if (right === undefined) {
						right = x + Math.max(0, width);
					}
					return right;
				},
				enumerable: true
			},
			top: {
				get: function () {
					if (top === undefined) {
						top = y + Math.min(0, height);
					}
					return top;
				},
				enumerable: true
			},
			bottom: {
				get: function () {
					if (bottom === undefined) {
						bottom = y + Math.max(0, height);
					}
					return bottom;
				},
				enumerable: true
			}
		});
	}

	Object.defineProperty(DOMRect.prototype, 'toJSON', {
		value: function () {
			return {
				x: this.x,
				y: this.y,
				width: this.width,
				height: this.height,
				top: this.top,
				right: this.right,
				bottom: this.bottom,
				left: this.left
			};
		},
		configurable: true,
		writable: true
	});

	Object.defineProperty(DOMRect, 'fromRect', {
		value: function (rect) {
			rect = rect || {};
			return new DOMRect(rect.x, rect.y, rect.width, rect.height);
		},
		configurable: true,
		writable: true
	});
	
	global.DOMRect = DOMRect;
}(self));

/**
 * Force babel to interpret this file as ESM so it
 * polyfills with ESM imports instead of CommonJS.
 */
export {}
