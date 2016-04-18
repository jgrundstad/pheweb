
$.getJSON("/api/pheno/" + window.pheno + ".json").done(function(variants) {
    window.variant_bins = variants.variant_bins;
    window.unbinned_variants = variants.unbinned_variants;
    $(create_gwas_plot);
});

var get_chrom_offsets = _.memoize(function() {
    var chrom_padding = 2e7;
    var chrom_extents = {};

    var update_chrom_extents = function(variant) {
        if (!(variant.chrom in chrom_extents)) {
            chrom_extents[variant.chrom] = [variant.pos, variant.pos];
        } else if (variant.pos > chrom_extents[variant.chrom][1]) {
            chrom_extents[variant.chrom][1] = variant.pos;
        } else if (variant.pos < chrom_extents[variant.chrom][0]) {
            chrom_extents[variant.chrom][0] = variant.pos;
        }
    }
    window.variant_bins.forEach(update_chrom_extents);
    window.unbinned_variants.forEach(update_chrom_extents);

    var chroms = _.sortBy(Object.keys(chrom_extents), Number.parseInt);

    var chrom_genomic_start_positions = {};
    chrom_genomic_start_positions[chroms[0]] = 0;
    for (var i=1; i<chroms.length; i++) {
        chrom_genomic_start_positions[chroms[i]] = chrom_genomic_start_positions[chroms[i-1]] + chrom_extents[chroms[i-1]][1] - chrom_extents[chroms[i-1]][0] + chrom_padding;
    }

    // chrom_offsets are defined to be the numbers that make `get_genomic_position()` work.
    // ie, they leave a gap of `chrom_padding` between the last variant on one chromosome and the first on the next.
    var chrom_offsets = {};
    Object.keys(chrom_genomic_start_positions).forEach(function(chrom) {
        chrom_offsets[chrom] = chrom_genomic_start_positions[chrom] - chrom_extents[chrom][0];
    });

    return {
        chrom_extents: chrom_extents,
        chroms: chroms,
        chrom_genomic_start_positions: chrom_genomic_start_positions,
        chrom_offsets: chrom_offsets,
    };
});

function get_genomic_position(variant) {
    var chrom_offsets = get_chrom_offsets().chrom_offsets;
    return chrom_offsets[variant.chrom] + variant.pos;
}

function create_gwas_plot() {
    var svg_width = $('#plot_container').width();
    var svg_height = 550;
    var plot_margin = {
        'left': 70,
        'right': 30,
        'top': 10,
        'bottom': 50,
    };
    var plot_width = svg_width - plot_margin.left - plot_margin.right;
    var plot_height = svg_height - plot_margin.top - plot_margin.bottom;

    var gwas_svg = d3.select('#plot_container').append("svg")
        .attr('id', 'gwas_svg')
        .attr("width", svg_width)
        .attr("height", svg_height)
        .style("display", "block")
        .style("margin", "auto");
    var gwas_plot = gwas_svg.append("g")
        .attr('id', 'gwas_plot')
        .attr("transform", fmt("translate({0},{1})", plot_margin.left, plot_margin.top));

    // Significance Threshold line
    var significance_threshold = 5e-8;
    var significance_threshold_tooltip = d3.tip()
        .attr('class', 'd3-tip')
        .html('Significance Threshold: 5E-8')
        .offset([-8,0]);
    gwas_svg.call(significance_threshold_tooltip);

    var genomic_position_extent = (function() {
        var extent1 = d3.extent(window.variant_bins, get_genomic_position);
        var extent2 = d3.extent(window.unbinned_variants, get_genomic_position);
        return d3.extent(extent1.concat(extent2));
    })();

    var x_scale = d3.scale.linear()
        .domain(genomic_position_extent)
        .range([0, plot_width]);

    var max_neglog10_pval = (function() {
        if (window.unbinned_variants.length > 0) {
            return d3.max(window.unbinned_variants, function(d) {
                return -Math.log10(d.pval);
            });
        }
        return d3.max(window.variant_bins, function(bin) {
            return d3.max(bin, prop('neglog10_pval'));
        });
    })();

    var y_scale = d3.scale.linear()
        .domain([Math.max(10, max_neglog10_pval), 0])
        .range([0, plot_height]);

    var color_by_chrom = d3.scale.ordinal()
        .domain(get_chrom_offsets().chroms)
        .range(['rgb(120,120,186)', 'rgb(0,0,66)']);
    //colors to maybe sample from later:
    //.range(['rgb(120,120,186)', 'rgb(0,0,66)', 'rgb(44,150,220)', 'rgb(40,60,80)', 'rgb(33,127,188)', 'rgb(143,76,176)']);

    gwas_plot.append('line')
        .attr('x1', 0)
        .attr('x2', plot_width)
        .attr('y1', y_scale(-Math.log10(significance_threshold)))
        .attr('y2', y_scale(-Math.log10(significance_threshold)))
        .attr('stroke-width', '5px')
        .attr('stroke', 'lightgray')
        .attr('stroke-dasharray', '10,10')
        .on('mouseover', significance_threshold_tooltip.show)
        .on('mouseout', significance_threshold_tooltip.hide);

    // Points & labels
    var tooltip_template = _.template($('#tooltip-template').html());
    var point_tooltip = d3.tip()
        .attr('class', 'd3-tip')
        .html(function(d) {
            return tooltip_template({d: d});
        })
        .offset([-6,0]);
    gwas_svg.call(point_tooltip);

    function pp1() {
    gwas_plot.append('g')
        .attr('class', 'variant_hover_rings')
        .selectAll('a.variant_hover_ring')
        .data(window.unbinned_variants)
        .enter()
        .append('a')
        .attr('class', 'variant_hover_ring')
        .attr('xlink:href', function(d) {
            return fmt('/variant/{0}-{1}-{2}-{3}', d.chrom, d.pos, d.ref, d.alt);
        })
        .append('circle')
        .attr('cx', function(d) {
            return x_scale(get_genomic_position(d));
        })
        .attr('cy', function(d) {
            return y_scale(-Math.log10(d.pval));
        })
        .attr('r', 7)
        .style('opacity', 0)
        .style('stroke-width', 1)
        .on('mouseover', function(d) {
            //Note: once a tooltip has been explicitly placed once, it must be explicitly placed forever after.
            var target_node = document.getElementById(fmt('variant-point-{0}-{1}-{2}-{3}', d.chrom, d.pos, d.ref, d.alt));
            point_tooltip.show(d, target_node);
        })
        .on('mouseout', point_tooltip.hide);
    }
    pp1();

    function pp2() {
    gwas_plot.append('g')
        .attr('class', 'variant_points')
        .selectAll('a.variant_point')
        .data(window.unbinned_variants)
        .enter()
        .append('a')
        .attr('class', 'variant_point')
        .attr('xlink:href', function(d) {
            return fmt('/variant/{0}-{1}-{2}-{3}', d.chrom, d.pos, d.ref, d.alt);
        })
        .append('circle')
        .attr('id', function(d) {
            return fmt('variant-point-{0}-{1}-{2}-{3}', d.chrom, d.pos, d.ref, d.alt);
        })
        .attr('cx', function(d) {
            return x_scale(get_genomic_position(d));
        })
        .attr('cy', function(d) {
            return y_scale(-Math.log10(d.pval));
        })
        .attr('r', 2.3)
        .style('fill', function(d) {
            return color_by_chrom(d.chrom);
        })
        .on('mouseover', function(d) {
            //Note: once a tooltip has been explicitly placed once, it must be explicitly placed forever after.
            point_tooltip.show(d, this);
        })
        .on('mouseout', point_tooltip.hide);
    }
    pp2();

    //loop through to replace .each()

    function pp3() { // drawing the ~60k binned variant circles takes ~500ms.  The (far fewer) unbinned variants take much less time.
    var bins = gwas_plot.append('g')
        .attr('class', 'bins')
        .selectAll('g.bin')
        .data(window.variant_bins)
        .enter()
        .append('g')
        .attr('class', 'bin')
        .each(function(d) { //todo: do this in a forEach
            d.x = x_scale(get_genomic_position(d));
            d.color = color_by_chrom(d.chrom);
        });
    bins.selectAll('circle.binned_variant_little_point')
        .data(prop('neglog10_pvals'))
        .enter()
        .append('circle')
        .attr('class', 'binned_variant_little_point')
        .attr('cx', function() {
            //return x_scale(get_genomic_position(d3.select(this.parentNode).datum())); //slow
            //return x_scale(get_genomic_position(this.parentNode.__data__)); //slow
            return this.parentNode.__data__.x;
        })
        .attr('cy', function(neglog10_pval) {
            return y_scale(neglog10_pval);
        })
        .attr('r', 2.3)
        .style('fill', function() {
            // return color_by_chrom(d3.select(this.parentNode).datum().chrom); //slow
            // return color_by_chrom(this.parentNode.__data__.chrom); //slow?
            return this.parentNode.__data__.color;
        });
    }
    pp3();

    function pp3_2() {
    gwas_plot.selectAll('nopenopenope')
        .data(window.variant_bins)
        .enter()
        .append('g')
        .each(function(bin) {
            var x = x_scale(get_genomic_position(bin));
            var color = color_by_chrom(bin.chrom);
            bin.neglog10_pvals.forEach(function(neglog10_pval) {
                gwas_plot
                    .append('circle')
                    .attr('cx', x)
                    .attr('cy', y_scale(neglog10_pval))
                    .attr('r', 2.3)
                    .style('fill', color);
            });
        });
    }
    //pp3_2(); //slow

    // Axes
    var yAxis = d3.svg.axis()
        .scale(y_scale)
        .orient("left")
        .tickFormat(d3.format("d"));
    gwas_plot.append("g")
        .attr("class", "y axis")
        .attr('transform', 'translate(-8,0)') // avoid letting points spill through the y axis.
        .call(yAxis);

    gwas_svg.append('text')
        .style('text-anchor', 'middle')
        .attr('transform', fmt('translate({0},{1})rotate(-90)',
                               plot_margin.left*.4,
                               plot_height/2 + plot_margin.top))
        .text('-log10(pvalue)');

    var chroms_and_midpoints = (function() {
        var v = get_chrom_offsets();
        return v.chroms.map(function(chrom) {
            return {
                chrom: chrom,
                midpoint: v.chrom_genomic_start_positions[chrom] + (v.chrom_extents[chrom][1] - v.chrom_extents[chrom][0]) / 2,
            };
        });
    })();
    console.log(chroms_and_midpoints);

    gwas_svg.selectAll('text.chrom_label')
        .data(chroms_and_midpoints)
        .enter()
        .append('text')
        .style('text-anchor', 'middle')
        .attr('transform', function(d) {
            return fmt('translate({0},{1})',
                       plot_margin.left + x_scale(d.midpoint),
                       plot_height + plot_margin.top + 20);
        })
        .text(function(d) {
            return d.chrom;
        })
        .style('fill', function(d) {
            return color_by_chrom(d.chrom);
        });

}
