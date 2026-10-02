// Only the chart types the product uses, registered on echarts/core with the SVG renderer (TECHNICAL_DESIGN §7.1).
// Loaded with a dynamic import from the chart component, so it never enters the first-paint bundle.
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import { AriaComponent, GridComponent, TitleComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';

echarts.use([LineChart, BarChart, PieChart, GridComponent, TooltipComponent, AriaComponent, TitleComponent, SVGRenderer]);
export default echarts;
