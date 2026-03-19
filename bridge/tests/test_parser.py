import pytest
from bridge import classify_protocol, parse_tcpdump_line


def test_classify_protocol():
    assert classify_protocol("ICMP echo request") == "ICMP"
    assert classify_protocol("domain") == "DNS"
    assert classify_protocol("HTTP/1.1") == "HTTP"
    assert classify_protocol("UDP") == "UDP"
    assert classify_protocol("Flags [S]") == "TCP"


def test_parse_tcpdump_line_Standard():
    line = "1709000000.123456 IP 192.168.1.11.54321 > 192.168.1.100.80: Flags [S]"
    parsed = parse_tcpdump_line(line, "pc1")
    assert parsed is not None
    assert parsed["src"] == "192.168.1.11"
    assert parsed["dst"] == "192.168.1.100"
    assert parsed["proto"] == "TCP"


def test_parse_tcpdump_line_LinuxSLL2():
    line = "1772172544.818086 eth0  Out IP 10.0.1.10 > 10.0.2.10: ICMP echo request, id 3, seq 421, length 64"
    parsed = parse_tcpdump_line(line, "router1")
    assert parsed is not None
    assert parsed["src"] == "10.0.1.10"
    assert parsed["dst"] == "10.0.2.10"
    assert parsed["proto"] == "ICMP"
    assert parsed["bytes"] == 64


def test_parse_tcpdump_line_Invalid():
    line = "This is not a topdump line"
    parsed = parse_tcpdump_line(line, "pc1")
    assert parsed is None
